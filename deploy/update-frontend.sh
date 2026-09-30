#!/usr/bin/env bash
# Put the latest frontend from GitHub live and rebuild only the frontend
# container. Backend, database and judge are left alone. The previous
# frontend source is saved to /opt/deadlock/backups first.
#   usage: update-frontend.sh [branch-or-commit]   (default: main)
set -euo pipefail

REPO="warun7/deadlock"
REF="${1:-main}"
ROOT="${ROOT:-/opt/deadlock}"

# Reuse exactly how the running frontend container was started
label() { docker inspect deadlock-frontend --format "{{index .Config.Labels \"com.docker.compose.$1\"}}" 2>/dev/null || true; }
PROJECT="$(label project)"; PROJECT="${PROJECT:-deadlock}"
WORKDIR="$(label project.working_dir)"; WORKDIR="${WORKDIR:-$ROOT/deploy}"
FILES="$(label project.config_files)"; FILES="${FILES:-$ROOT/deploy/docker-compose.yml}"
ENVFILE="$(label project.environment_file)"
if docker compose version >/dev/null 2>&1; then DC=(docker compose); else DC=(docker-compose); fi
DC+=(-p "$PROJECT" --project-directory "$WORKDIR")
IFS=',' read -ra CFS <<< "$FILES"; for f in "${CFS[@]}"; do DC+=(-f "$f"); done
if [ -n "$ENVFILE" ]; then DC+=(--env-file "$ENVFILE"); fi

command -v rsync >/dev/null || { apt-get update -qq && apt-get install -y -qq rsync; }

SHA="$(curl -fsSL -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$REF")"
echo "-> Deploying $REPO@${SHA:0:7} ($REF)"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$SHA" | tar -xz -C "$TMP" --strip-components=1
[ -f "$TMP/frontend/package.json" ] || { echo "Download looks wrong, stopping. Nothing was changed."; exit 1; }

echo "-> Backing up the current frontend to $ROOT/backups"
mkdir -p "$ROOT/backups"
tar -czf "$ROOT/backups/frontend-$(date +%Y%m%d-%H%M%S).tgz" -C "$ROOT" frontend
ls -1t "$ROOT"/backups/frontend-*.tgz | tail -n +6 | xargs -r rm --

echo "-> Copying the new source (keeping this server's Dockerfile, Caddyfile and env files)"
rsync -a --delete --exclude Dockerfile --exclude Caddyfile --exclude .dockerignore \
  --exclude '.env*' --exclude node_modules --exclude dist \
  "$TMP/frontend/" "$ROOT/frontend/"

echo "-> Building the new frontend (a minute or two)"
"${DC[@]}" build frontend
echo "-> Swapping the live container"
"${DC[@]}" up -d --no-deps frontend

echo "$SHA" > "$ROOT/deploy/.frontend-version"
echo "Done. Live: frontend @ ${SHA:0:7}"
