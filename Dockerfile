# ============================================================
#  Aternos24-7-HostingBot — explicit Docker build
#  Bypasses Railway/Railpack auto-detection (which can fail
#  before the app build even starts) with a fixed, reproducible
#  environment: Node 22 LTS on Debian slim.
# ============================================================

FROM node:22-slim

ENV NODE_ENV=production

WORKDIR /app

# 1) Install dependencies first — this layer is cached and only
#    re-runs when package.json / package-lock.json change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 2) Copy the application source (runs as unprivileged 'node' user)
COPY --chown=node:node . .
USER node

# Railway injects PORT automatically; 5000 is the local default.
ENV PORT=5000
EXPOSE 5000

# Start Node directly (not via npm) so SIGTERM reaches the process
# and the bot shuts down cleanly during redeploys.
CMD ["node", "index.js"]
