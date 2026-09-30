#!/usr/bin/env bash
# Entry point for the GitHub Actions deploy key. In /root/.ssh/authorized_keys
# that key is pinned to this script with `restrict,command="..."`, so the key
# can do exactly one thing: deploy a commit. The commit SHA arrives as the
# SSH command; anything that is not a full SHA is refused.
set -euo pipefail

REF="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$REF" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Refusing: expected a 40-character commit SHA." >&2
  exit 2
fi

# One deploy at a time, whether it came from CI or someone at the console
exec flock -w 900 /tmp/deadlock-frontend-deploy.lock /opt/deadlock/deploy/update-frontend.sh "$REF"
