#!/usr/bin/env bash
# Replaced by release.sh, which ships frontend, backend and deploy config
# together. Kept so older instructions still work.
exec flock -w 900 /tmp/deadlock-deploy.lock /opt/deadlock/deploy/release.sh "$@"
