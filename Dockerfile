# syntax=docker/dockerfile:1

ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run typecheck && npm test && npm run build

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

# Runtime

FROM node:${NODE_VERSION}-alpine
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    STONESCRIBE_VAULT=/vault

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# The vault is a bind mount owned by the host user. `node` is uid/gid 1000; override with
# `--user $(id -u):$(id -g)` when the vault belongs to someone else.
RUN mkdir -p /vault && chown node:node /vault
USER node
VOLUME /vault
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

CMD ["node", "dist/server/server/index.js"]
