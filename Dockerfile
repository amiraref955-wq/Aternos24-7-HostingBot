# ============================================================
#  Aternos24-7-HostingBot — explicit Docker build
#  Bypasses Railway/Railpack auto-detection (which can fail
#  before the app build even starts) with a fixed, reproducible
#  environment: Node 22 LTS on Debian slim.
# ============================================================

FROM node:22-slim

ENV NODE_ENV=production

# gosu: used by the entrypoint to drop from root to the 'node' user
# after fixing volume permissions (Railway mounts volumes root-owned)
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Install dependencies first — this layer is cached and only
#    re-runs when package.json / package-lock.json change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 2) Copy the application source (node-owned so the settings fallback
#    path /app/settings.json stays writable if the volume ever fails)
COPY --chown=node:node . .

# 3) Persistent data mount point. Railway: attach a Volume mounted at
#    /data (the platform then injects RAILWAY_VOLUME_MOUNT_PATH itself).
#    Docker hosts: run with `-v yourdata:/data`.
ENV DATA_DIR=/data
RUN mkdir -p /data

# 4) Entrypoint chowns /data to node:node (root-owned volume mounts!),
#    then drops privileges to the unprivileged 'node' user.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

# Railway injects PORT automatically; 5000 is the local default.
ENV PORT=5000
EXPOSE 5000

# Start Node directly (not via npm) so SIGTERM reaches the process
# and the bot shuts down cleanly during redeploys.
CMD ["node", "index.js"]
