#!/bin/sh
# ============================================================
#  Entrypoint: fix volume permissions, then drop privileges.
#  Railway (and other PaaS) mount Volumes as root:root. The app
#  runs as the unprivileged 'node' user, which would get EACCES.
#  This script chowns the data dir to node:node on startup, then
#  executes the app as 'node' via gosu.
# ============================================================
set -e

DATA_DIR="${RAILWAY_VOLUME_MOUNT_PATH:-${DATA_DIR:-/data}}"

if [ "$(id -u)" = "0" ]; then
  if [ -d "$DATA_DIR" ]; then
    echo "[entrypoint] Fixing ownership of $DATA_DIR for the node user..."
    chown -R node:node "$DATA_DIR" || true
  fi
  echo "[entrypoint] Starting app as unprivileged 'node' user..."
  exec gosu node "$@"
fi

# Already non-root (local dev, docker run --user) - just exec
exec "$@"
