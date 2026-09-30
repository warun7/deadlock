#!/usr/bin/env bash
# ============================================================
# One-time host preparation for a fresh Ubuntu VPS.
# ============================================================
# Installs Docker, adds swap, and locks the firewall down to SSH + web.
#
# Run once, as root, on a NEWLY CREATED droplet:
#
#   sudo ./bootstrap.sh
#
# Safe to re-run: every step checks before it acts.
# ============================================================

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must run as root. Try:  sudo ./bootstrap.sh" >&2
  exit 1
fi

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

# ------------------------------------------------------------
# 1. Swap
# ------------------------------------------------------------
# Judge0 spawns a process per submission and can spike hard. Without swap a
# small droplet hits the OOM killer and takes the whole stack down with it.
# swappiness=10 means the kernel still prefers RAM and only leans on swap
# under real pressure.
log "Configuring swap"

if swapon --show | grep -q '/swapfile'; then
  echo "Swapfile already active, skipping."
else
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  echo "2G swapfile enabled."
fi

if ! grep -q '^/swapfile' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

sysctl -w vm.swappiness=10 >/dev/null
if ! grep -q '^vm.swappiness' /etc/sysctl.conf; then
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

# ------------------------------------------------------------
# 2. cgroup v1  (REQUIRED by Judge0 -- do not remove)
# ------------------------------------------------------------
# Judge0 1.13.1 bundles isolate 1.8.1, which builds its sandbox using the
# cgroup v1 path /sys/fs/cgroup/memory/box-<id>/. Ubuntu 22.04+ boots with the
# unified cgroup v2 hierarchy by default, where that path does not exist.
#
# The resulting failure is confusing rather than obvious: isolate cannot create
# the box, so Judge0 then cannot write the source file into it, and *every*
# submission returns:
#   Internal Error: No such file or directory @ rb_sysopen - /box/script.py
#
# This is the fix prescribed by Judge0's own deployment documentation for
# Ubuntu 22.04. It needs a reboot to take effect.
log "Ensuring cgroup v1 (required by Judge0)"

NEEDS_REBOOT=0

if [ -d /sys/fs/cgroup/memory ]; then
  echo "cgroup v1 memory controller already present, nothing to do."
else
  GRUB_FILE=/etc/default/grub

  if [ ! -f "${GRUB_FILE}" ]; then
    echo "WARNING: ${GRUB_FILE} not found; this host may not use GRUB." >&2
    echo "Judge0 cannot work until cgroup v1 is enabled. See deploy/README.md." >&2
  else
    if ! grep -q 'systemd.unified_cgroup_hierarchy=0' "${GRUB_FILE}"; then
      cp "${GRUB_FILE}" "${GRUB_FILE}.bak"
      sed -i 's/^GRUB_CMDLINE_LINUX="\(.*\)"$/GRUB_CMDLINE_LINUX="\1 systemd.unified_cgroup_hierarchy=0"/' "${GRUB_FILE}"

      if ! grep -q 'systemd.unified_cgroup_hierarchy=0' "${GRUB_FILE}"; then
        echo 'GRUB_CMDLINE_LINUX="systemd.unified_cgroup_hierarchy=0"' >> "${GRUB_FILE}"
      fi

      echo "Added systemd.unified_cgroup_hierarchy=0 to ${GRUB_FILE} (backup: ${GRUB_FILE}.bak)"

      if command -v update-grub >/dev/null 2>&1; then
        update-grub
      else
        grub-mkconfig -o /boot/grub/grub.cfg
      fi
    else
      echo "GRUB is already configured for cgroup v1."
    fi

    NEEDS_REBOOT=1
  fi
fi

# ------------------------------------------------------------
# 3. Docker
# ------------------------------------------------------------
log "Installing Docker"


if command -v docker >/dev/null 2>&1; then
  echo "Docker already installed: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable --now docker

# ------------------------------------------------------------
# 4. Container log rotation
# ------------------------------------------------------------
# Without this, container logs grow until the disk fills. The compose file sets
# per-service limits too; this is the daemon-wide default.
log "Configuring Docker log rotation"

if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
  echo "Log rotation configured (10MB x 3 files per container)."
else
  echo "/etc/docker/daemon.json already exists, leaving it alone."
fi

# ------------------------------------------------------------
# 5. Firewall
# ------------------------------------------------------------
# Only SSH and the web ports are reachable. Judge0, Redis and the backend are
# bound to the internal Docker network (or loopback), so they need no rule.
log "Configuring firewall"

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  echo "ufw enabled: SSH, 80, 443 allowed. Everything else denied."
else
  echo "ufw not present, skipping firewall setup." >&2
fi

# ------------------------------------------------------------
# 6. Report
# ------------------------------------------------------------
CGROUP_VERSION=$(stat -fc %T /sys/fs/cgroup 2>/dev/null || echo unknown)
MEM_TOTAL=$(free -h | awk '/^Mem:/{print $2}')
CGROUP_V1_READY=no
[ -d /sys/fs/cgroup/memory ] && CGROUP_V1_READY=yes

log "Host ready"
cat <<EOF
Memory:              ${MEM_TOTAL}
Swap:                $(free -h | awk '/^Swap:/{print $2}')
Cgroup fs type:      ${CGROUP_VERSION}
cgroup v1 (Judge0):  ${CGROUP_V1_READY}
Docker:              $(docker --version)
EOF

if [ "${NEEDS_REBOOT}" -eq 1 ] && [ "${CGROUP_V1_READY}" != "yes" ]; then
  cat <<'EOF'

============================================================
 ACTION REQUIRED: reboot this server
============================================================
cgroup v1 has just been enabled in GRUB, but the kernel is
still running the old configuration. Judge0 WILL NOT WORK
until you reboot.

    sudo reboot

Reconnect after about 30 seconds, confirm it took effect:

    ls /sys/fs/cgroup/memory

That directory must exist. If it does, continue below.
============================================================
EOF
fi

cat <<'EOF'

Next steps:
  1. Reboot if instructed above
  2. Point DNS at this server (see deploy/README.md), then wait for it to resolve
  3. cd deploy
  4. cp .env.example .env && nano .env
  5. ./deploy.sh
EOF
