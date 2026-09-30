#!/usr/bin/env bash
# ============================================================
# Build and release the whole Deadlock stack.
# ============================================================
# This is the only command you need after the first-time setup:
#
#   cd deploy && ./deploy.sh
#
# It is idempotent -- run it again after any code change to rebuild and roll
# forward. Existing data (Redis, Judge0's database, TLS certificates) is
# preserved across runs.
# ============================================================

set -euo pipefail
cd "$(dirname "$0")"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

# Ask a yes/no question, but only when a human can actually answer it.
# Without this, a `read` in a GitHub Actions run blocks until the job's timeout
# instead of failing fast.
confirm() {
  local prompt="$1"

  if [ ! -t 0 ]; then
    echo "${prompt}"
    echo "  (no terminal attached -- continuing automatically)"
    return 0
  fi

  local reply
  read -r -p "${prompt} [y/N] " reply
  case "${reply}" in
    [yY]*) return 0 ;;
    *) return 1 ;;
  esac
}

# ------------------------------------------------------------
# 1. Configuration
# ------------------------------------------------------------
if [ ! -f .env ]; then
  fail "deploy/.env not found.
  Create it first:  cp .env.example .env  &&  nano .env"
fi

# Export every variable in .env into this shell so ${VAR} works for validation.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

REQUIRED_VARS=(
  DOMAIN
  API_DOMAIN
  ACME_EMAIL
  FRONTEND_URL
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_JWT_SECRET
  ADMIN_SECRET
  VITE_SUPABASE_URL
  VITE_SUPABASE_ANON_KEY
  VITE_SOCKET_URL
)

MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  printf '\n\033[1;31mThese variables are empty in deploy/.env:\033[0m\n' >&2
  printf '  - %s\n' "${MISSING[@]}" >&2
  printf '\nFill them in and run ./deploy.sh again.\n' >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is not installed. Run:  sudo ./bootstrap.sh"
fi

# ------------------------------------------------------------
# 2. cgroup v1 preflight (Judge0 hard requirement)
# ------------------------------------------------------------
# Without this, Judge0 accepts submissions and then fails every single one with
# "Internal Error: /box/script.py", which looks like an application bug rather
# than a host configuration problem. Catch it here, loudly, instead.
if [ ! -d /sys/fs/cgroup/memory ]; then
  cat <<'EOF'

============================================================
 Judge0 CANNOT WORK on this host yet
============================================================
cgroup v1 is not enabled, but Judge0 1.13.1 requires it.

Without it, every code submission fails with:
  Internal Error: No such file or directory @ rb_sysopen - /box/script.py

Fix (one time, then reboot):

  sudo ./bootstrap.sh
  sudo reboot
  ls /sys/fs/cgroup/memory     # must exist after rebooting

If it still does not exist after rebooting, check the kernel parameter:

  cat /proc/cmdline            # should contain systemd.unified_cgroup_hierarchy=0

EOF
  if ! confirm "Deploy anyway (Judge0 will not execute code)?"; then
    fail "Stopped. Enable cgroup v1 first."
  fi
  echo "Continuing without working code execution."
fi

# ------------------------------------------------------------
# 3. Judge0 secrets (generated once, then left alone)
# ------------------------------------------------------------
if [ ! -f judge0.conf ]; then
  log "Generating judge0.conf with fresh random secrets"
  cat > judge0.conf <<EOF
POSTGRES_HOST=judge0-db
POSTGRES_DB=judge0
POSTGRES_USER=judge0
POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_HOST=judge0-redis
REDIS_PASSWORD=$(openssl rand -hex 24)
SECRET_KEY_BASE=$(openssl rand -hex 64)
EOF
  echo "Created deploy/judge0.conf"
else
  echo "Using existing deploy/judge0.conf"
fi

# The Judge0 image runs as uid 1000 / gid 999, so a root-only 0600 file is
# UNREADABLE INSIDE THE CONTAINER. When that happens ./scripts/load-config fails
# with "Permission denied", POSTGRES_HOST is never set, and Rails dies with
# PG::ConnectionBad while the container crash-loops. Hand the file to the
# container's user rather than loosening the mode.
if chown 1000:999 judge0.conf 2>/dev/null; then
  chmod 600 judge0.conf
  echo "judge0.conf owned by 1000:999, mode 600"
else
  # Not running as root. The container user must still be able to read it.
  chmod 644 judge0.conf
  echo "WARNING: could not chown judge0.conf to the container user."
  echo "         Made it world-readable so Judge0 can load it."
fi

JUDGE0_WORKERS="${JUDGE0_WORKERS:-1}"

# ------------------------------------------------------------
# 4. Resolve DNS before we try to get certificates
# ------------------------------------------------------------
# A failed ACME challenge is the single most common first-boot failure, and the
# error Caddy prints is not obvious if you are not expecting it. Check first.
log "Checking DNS for ${DOMAIN} and ${API_DOMAIN}"

SERVER_IP=$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || echo "")
echo "This server's public IP: ${SERVER_IP:-unknown}"

dns_ok=true
for host in "${DOMAIN}" "${API_DOMAIN}"; do
  resolved=$(getent hosts "${host}" 2>/dev/null | awk '{print $1; exit}' || true)
  if [ -z "${resolved}" ]; then
    echo "  ${host} -> NOT RESOLVING"
    dns_ok=false
  elif [ -n "${SERVER_IP}" ] && [ "${resolved}" != "${SERVER_IP}" ]; then
    echo "  ${host} -> ${resolved}  (WARNING: expected ${SERVER_IP})"
    dns_ok=false
  else
    echo "  ${host} -> ${resolved}  OK"
  fi
done

if [ "${dns_ok}" != true ]; then
  printf '\n\033[1;33mDNS is not pointing here yet.\033[0m\n'
  echo "Caddy cannot obtain TLS certificates until it does, and the site will"
  echo "serve an invalid certificate. Point these A records at ${SERVER_IP:-this server}:"
  echo "  ${DOMAIN}, www.${DOMAIN}, ${API_DOMAIN}"
  echo
  if ! confirm "Continue anyway?"; then
    fail "Stopped. Fix DNS, then re-run ./deploy.sh"
  fi
  echo "Continuing."
fi

# ------------------------------------------------------------
# 5. Build
# ------------------------------------------------------------
log "Building images (this takes a few minutes on first run)"
docker compose build --pull

# ------------------------------------------------------------
# 6. Start
# ------------------------------------------------------------
log "Starting services"
docker compose up -d --scale "judge0-workers=${JUDGE0_WORKERS}"

# ------------------------------------------------------------
# 7. Wait for readiness
# ------------------------------------------------------------
wait_for() {
  local name="$1" url="$2" attempts="$3"
  printf 'Waiting for %s' "${name}"
  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS --max-time 3 "${url}" >/dev/null 2>&1; then
      printf ' ready\n'
      return 0
    fi
    printf '.'
    sleep 3
  done
  printf ' TIMED OUT\n'
  return 1
}

judge0_ready=true
backend_ready=true
judge0_exec_ok=true

# Judge0 boots Rails and runs its own migrations, so it is the slow one.
# On a 1-vCPU droplet a cold boot can take several minutes, especially when the
# image build is competing for CPU -- 360s is deliberately generous so a slow
# boot produces a real wait rather than a false "not ready" warning.
wait_for "Judge0" "http://127.0.0.1:2358/about" 120 || judge0_ready=false

# /about answering does NOT mean code execution works. If judge0.conf is
# unreadable, the HTTP layer still comes up while every submission fails, so
# run a real program rather than trusting the health endpoint.
if [ "${judge0_ready}" = true ]; then
  printf 'Verifying Judge0 can execute code'
  exec_result=$(curl -fsS --max-time 60 \
    -X POST "http://127.0.0.1:2358/submissions?base64_encoded=false&wait=true" \
    -H "Content-Type: application/json" \
    -d '{"source_code":"print(42)","language_id":71}' 2>/dev/null || echo "")

  if echo "${exec_result}" | grep -q '"id":3'; then
    printf ' verified\n'
  else
    printf ' FAILED\n'
    judge0_exec_ok=false
    echo "  Judge0 is reachable but could not run a trivial program."
    echo "  Response: $(echo "${exec_result}" | head -c 300)"
    echo "  Check: docker compose logs judge0-server"
  fi
fi
wait_for "backend" "http://127.0.0.1:3001/health" 20 || backend_ready=false

# ------------------------------------------------------------
# 8. Report
# ------------------------------------------------------------
log "Status"
docker compose ps

echo
if [ "${backend_ready}" = true ]; then
  echo "Backend health:"
  curl -fsS http://127.0.0.1:3001/health | sed 's/^/  /'
  echo
fi

if [ "${judge0_ready}" != true ]; then
  cat <<'EOF'
WARNING: Judge0 did not become ready.
Code submissions will fail until it does. Investigate with:
  docker compose logs judge0-server
  docker compose logs judge0-workers
  docker compose logs judge0-db
EOF
elif [ "${judge0_exec_ok}" != true ]; then
  cat <<'EOF'
WARNING: Judge0 is running but could not execute test code.
The most common cause is deploy/judge0.conf not being readable inside the
container (it must be owned by uid 1000:999). Check with:
  docker compose logs judge0-server | grep -i "permission denied"
EOF
fi

echo
echo "============================================================"
echo " Deadlock is deployed"
echo "============================================================"
echo "  App:    https://${DOMAIN}"
echo "  API:    https://${API_DOMAIN}"
echo
echo "  Logs:   docker compose logs -f backend"
echo "  Health: curl localhost:3001/health"
echo "  Stop:   docker compose down"
echo
echo "  Judge0 workers: ${JUDGE0_WORKERS}"
echo "============================================================"
