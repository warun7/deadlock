# syntax=docker/dockerfile:1

# ============================================
# Stage 1: build the Vite bundle
# ============================================
# Matches the backend's Node major so both images are built and run on the same
# runtime (see backend/Dockerfile for why 22 is required).
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Vite inlines every VITE_* variable into the JS bundle at BUILD time, not at
# runtime. These therefore have to be supplied as build arguments -- setting
# them as container environment variables later would have no effect.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_SOCKET_URL

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_SOCKET_URL=$VITE_SOCKET_URL

RUN npm run build

# ============================================
# Stage 2: serve the static bundle
# ============================================
FROM caddy:2-alpine AS runtime

COPY --from=build /app/dist /usr/share/caddy
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80
