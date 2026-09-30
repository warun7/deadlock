#!/usr/bin/env bash
# ============================================================
# Put a commit from GitHub live on this server.
# ============================================================
#   deploy/release.sh [branch-or-commit]      (default: main)
#
# Downloads that commit and copies frontend/, backend/ and deploy/ over this
# server's copy, then rebuilds and restarts only what changed:
#
#   frontend/                  -> frontend container
#   backend/                   -> backend container, health-checked, and put
#                                 back to the previous version if it fails
#   deploy/Caddyfile           -> edge reloads its config without dropping TLS
#   deploy/docker-compose.yml  -> compose applies the new definitions
#
# Never touched: deploy/.env, deploy/judge0.conf, Redis data, Judge0, the
# database, TLS certificates. If a build fails nothing live changes and the
# server's source is put back as it was. The previous source is kept in
# /opt/deadlock/backups (last 5).
#
# GitHub Actions runs this on every push to main (through ci-deploy.sh).
# ============================================================
set -euo pipefail

REPO="warun7/deadlock"
ROOT="${ROOT:-/opt/deadlock}"
DEPLOY="$ROOT/deploy"

# rsync rules per directory. Secrets and build output stay as they are.
APP_EXCLUDES=(--exclude '.env*' --exclude node_modules --exclude dist --exclude logs --exclude '*.log')
DEPLOY_RULES=(--include .env.example --exclude '.env*' --exclude judge0.conf
  --exclude .deployed-version --exclude .frontend-version)

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

# Everything runs inside main() so bash has read the whole script before
# release.sh copies a new version of itself over deploy/.
main() {
  local ref="${1:-main}"
  cd "$DEPLOY"
  command -v rsync >/dev/null || { apt-get update -qq && apt-get install -y -qq rsync; }

  # --------------------------------------------------------
  # 1. Download the commit
  # --------------------------------------------------------
  local sha
  if [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then
    sha="$ref"
  else
    sha="$(curl -fsSL -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$ref")"
  fi
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "Could not resolve '$ref' to a commit."
  log "Releasing $REPO@${sha:0:7} ($ref)"

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$sha" | tar -xz -C "$TMP" --strip-components=1
  for f in frontend/package.json backend/package.json deploy/docker-compose.yml deploy/Caddyfile; do
    [ -f "$TMP/$f" ] || fail "Download is missing $f. Nothing was changed."
  done

  # --------------------------------------------------------
  # 2. Work out what changed (by content, against this server's copy)
  # --------------------------------------------------------
  local frontend_changed=false backend_changed=false compose_changed=false caddy_changed=false deploy_changed=false
  differs frontend "${APP_EXCLUDES[@]}" --delete && frontend_changed=true
  differs backend "${APP_EXCLUDES[@]}" --delete && backend_changed=true
  differs deploy "${DEPLOY_RULES[@]}" && deploy_changed=true
  cmp -s "$TMP/deploy/docker-compose.yml" "$DEPLOY/docker-compose.yml" || compose_changed=true
  cmp -s "$TMP/deploy/Caddyfile" "$DEPLOY/Caddyfile" || caddy_changed=true
  echo "frontend: $frontend_changed  backend: $backend_changed  compose: $compose_changed  caddy: $caddy_changed  other deploy files: $deploy_changed"

  if ! $frontend_changed && ! $backend_changed && ! $deploy_changed; then
    echo "$sha" > "$DEPLOY/.deployed-version"
    log "Nothing to change. Live: ${sha:0:7}"
    return 0
  fi

  # --------------------------------------------------------
  # 3. Back up the current source, remember the running images
  # --------------------------------------------------------
  mkdir -p "$ROOT/backups"
  BACKUP="$ROOT/backups/release-$(date +%Y%m%d-%H%M%S).tgz"
  tar -czf "$BACKUP" -C "$ROOT" --exclude node_modules --exclude dist \
    --exclude 'deploy/.env' --exclude 'deploy/judge0.conf' frontend backend deploy
  ls -1t "$ROOT"/backups/release-*.tgz | tail -n +6 | xargs -r rm --
  echo "Backed up the current source to $BACKUP"

  # Tag the running images so a failed release can go back to them. The tag
  # also keeps them from being pruned.
  local svc image rollback=()
  for svc in frontend backend; do
    image="$(docker inspect -f '{{.Config.Image}}' "deadlock-$svc" 2>/dev/null || true)"
    if [ -n "$image" ]; then
      docker tag "$(docker inspect -f '{{.Image}}' "deadlock-$svc")" "deadlock-$svc-previous:latest"
      rollback+=("$svc=$image")
    fi
  done

  # --------------------------------------------------------
  # 4. Copy the new source and build. A failed build changes nothing live.
  # --------------------------------------------------------
  log "Copying the new source"
  sync_dir frontend "${APP_EXCLUDES[@]}" --delete
  sync_dir backend "${APP_EXCLUDES[@]}" --delete
  # --inplace keeps the Caddyfile's inode, so edge's bind mount sees the new file
  sync_dir deploy "${DEPLOY_RULES[@]}" --inplace

  local build=()
  $frontend_changed && build+=(frontend)
  $backend_changed && build+=(backend)
  if [ ${#build[@]} -gt 0 ]; then
    log "Building ${build[*]} (a minute or two)"
    if ! docker compose build "${build[@]}"; then
      restore_source
      fail "Build failed. The live site was not changed and the source was put back."
    fi
  fi

  # --------------------------------------------------------
  # 5. Swap containers
  # --------------------------------------------------------
  if $compose_changed; then
    log "Applying the new docker-compose.yml"
    # Keep however many Judge0 workers are running now
    local workers
    workers="$( (docker compose ps -q judge0-workers 2>/dev/null || true) | wc -l)"
    [ "$workers" -ge 1 ] || workers=1
    docker compose up -d --scale "judge0-workers=$workers"
  elif [ ${#build[@]} -gt 0 ]; then
    log "Swapping ${build[*]}"
    docker compose up -d --no-deps "${build[@]}"
  fi

  if $caddy_changed; then
    log "Reloading edge config"
    if ! docker compose exec -T edge caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
      # Caddy keeps serving the old config when a reload is rejected
      tar -xzf "$BACKUP" -C "$TMP" deploy/Caddyfile
      cat "$TMP/deploy/Caddyfile" > "$DEPLOY/Caddyfile"
      fail "The new Caddyfile was rejected. Edge is still serving the old one, which is back on disk."
    fi
  fi

  # --------------------------------------------------------
  # 6. Check the backend, roll back if it does not come up
  # --------------------------------------------------------
  if $backend_changed || $compose_changed; then
    if ! wait_for_backend; then
      docker compose logs --tail 40 backend || true
      log "Backend did not come up. Rolling back frontend and backend to the previous release"
      local entry restored=()
      for entry in "${rollback[@]}"; do
        docker tag "deadlock-${entry%%=*}-previous:latest" "${entry#*=}"
        restored+=("${entry%%=*}")
      done
      restore_source
      if [ ${#restored[@]} -gt 0 ]; then
        docker compose up -d --no-deps --force-recreate "${restored[@]}"
        wait_for_backend || true
      fi
      fail "Backend failed its health check after the release. Logs are above."
    fi
  fi

  echo "$sha" > "$DEPLOY/.deployed-version"
  docker image prune -f >/dev/null || true
  log "Done. Live: ${sha:0:7}"
  docker compose ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null || docker compose ps
}

# True when copying $TMP/$1 over $ROOT/$1 would change anything
differs() {
  local dir="$1"; shift
  [ -n "$(rsync -rlpcn --itemize-changes "$@" "$TMP/$dir/" "$ROOT/$dir/")" ]
}

sync_dir() {
  local dir="$1"; shift
  rsync -rlpc "$@" "$TMP/$dir/" "$ROOT/$dir/"
}

# Put frontend/, backend/ and deploy/ back to the backup taken in step 3
restore_source() {
  local old="$TMP/restore"
  mkdir -p "$old"
  tar -xzf "$BACKUP" -C "$old"
  rsync -rlpc "${APP_EXCLUDES[@]}" --delete "$old/frontend/" "$ROOT/frontend/"
  rsync -rlpc "${APP_EXCLUDES[@]}" --delete "$old/backend/" "$ROOT/backend/"
  rsync -rlpc "${DEPLOY_RULES[@]}" --inplace "$old/deploy/" "$DEPLOY/"
  echo "Source restored from $BACKUP"
}

wait_for_backend() {
  printf 'Waiting for backend health'
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:3001/health >/dev/null 2>&1; then
      printf ' ok\n'
      return 0
    fi
    printf '.'
    sleep 3
  done
  printf ' TIMED OUT\n'
  return 1
}

main "$@"; exit $?
