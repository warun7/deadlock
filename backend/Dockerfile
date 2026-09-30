# syntax=docker/dockerfile:1

# ============================================
# Stage 1: build (TypeScript -> dist)
# ============================================
# Node 22 is a hard requirement, not a preference: @supabase/supabase-js
# (2.116.0, resolved from the ^2.39.0 range) throws at import time on Node 20
# because it needs the native global WebSocket that Node 22 provides.
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first so the dependency layer is cached independently of source
# changes. `npm ci` is used because package-lock.json is committed -- it installs
# the exact locked tree and fails loudly if the lockfile and package.json drift.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ============================================
# Stage 2: runtime (production deps only)
# ============================================
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/dist ./dist

# The logger creates ./logs on boot when file logging is enabled. Create it up
# front and hand the whole tree to the unprivileged `node` user, so the process
# can still write if LOG_TO_FILE is turned back on.
RUN mkdir -p /app/logs && chown -R node:node /app

# Never run the app as root.
USER node

EXPOSE 3001

# Uses Node's built-in fetch (Node 18+) so no curl/wget is needed in the image.
# /health returns 503 when Redis is unreachable, which surfaces as "unhealthy"
# in `docker compose ps` -- genuinely useful signal, and Docker will not restart
# a container merely for being unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
