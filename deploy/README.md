# Deploying the frontend

The site runs on a DigitalOcean droplet as Docker Compose containers in
`/opt/deadlock` (`deploy/docker-compose.yml` and `deploy/Caddyfile` live only on
the server). `/opt/deadlock` is a copy of the code, not a git checkout, so
pushing to GitHub does not change the site by itself.

- `update-frontend.sh` downloads a commit of this repo, backs up the current
  frontend to `/opt/deadlock/backups`, swaps in the new `frontend/` source
  (keeping the server's Dockerfile, Caddyfile and env files) and rebuilds only
  the frontend container. The backend, database and judge are not touched.
- `ci-deploy.sh` is what the GitHub Actions key is allowed to run. It accepts a
  commit SHA and nothing else.
- `.github/workflows/deploy-frontend.yml` builds and type-checks every push to
  `main` that touches `frontend/`, then deploys it over SSH.

Both scripts live in `/opt/deadlock/deploy/` on the droplet. The copies here are
for reference; the server does not pull them automatically.

## Deploy by hand

```bash
/opt/deadlock/deploy/update-frontend.sh          # latest main
/opt/deadlock/deploy/update-frontend.sh <sha>    # a specific commit
```

## One-time setup for automatic deploys

On the droplet, as root:

```bash
# 1. The only thing the GitHub key may run
curl -fsSL https://raw.githubusercontent.com/warun7/deadlock/main/deploy/ci-deploy.sh -o /opt/deadlock/deploy/ci-deploy.sh
chmod +x /opt/deadlock/deploy/ci-deploy.sh

# 2. A key just for GitHub, pinned to that script
install -m 700 -d /root/.ssh
ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f /root/.ssh/github_deploy <<<y >/dev/null
echo "restrict,command=\"/opt/deadlock/deploy/ci-deploy.sh\" $(cat /root/.ssh/github_deploy.pub)" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# 3. Print the three values GitHub needs
IP=$(curl -fsS http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)
echo "== DEPLOY_HOST =="; echo "$IP"
echo "== DEPLOY_KNOWN_HOSTS =="; echo "$IP $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
echo "== DEPLOY_SSH_KEY =="; cat /root/.ssh/github_deploy
```

In GitHub: **Settings → Secrets and variables → Actions → New repository
secret**, once for each of `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS` and
`DEPLOY_SSH_KEY` (for the key, include the `BEGIN` and `END` lines).

Then delete the private key from the server, since GitHub now holds the only
copy it needs: `rm /root/.ssh/github_deploy`.

Test it from **Actions → Deploy frontend → Run workflow**.

## If something goes wrong

- **Deploy step times out connecting:** a DigitalOcean Cloud Firewall may be
  limiting SSH (port 22) to certain IPs. GitHub's runners need to reach it.
- **"Refusing: expected a 40-character commit SHA":** the key is working; the
  workflow sent something other than a commit.
- **Roll back:** the five most recent frontends are in `/opt/deadlock/backups`.
  Redeploying an older commit is `update-frontend.sh <sha>`.
