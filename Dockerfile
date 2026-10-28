# @license GPL-3.0-or-later
# Copyright (C) 2025 Caleb Gyamfi - Omnixys Technologies
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
#
# For more information, visit <https://www.gnu.org/licenses/>.
# ---------------------------------------------------------------------------------------
# Dockerfile – Omnixys Chat Service
# Multi-stage build optimized for security, reproducibility, and minimal runtime size.
# ---------------------------------------------------------------------------------------
# syntax=docker/dockerfile:1.14.0

ARG NODE_VERSION=26.8.1

# ---------------------------------------------------------------------------------------
# Stage 0: Base image
# - Common setup for all later build stages.
# - Corepack is enabled to support pnpm package manager.
# ---------------------------------------------------------------------------------------
FROM docker.io/library/node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /home/node
RUN npm install -g pnpm@11.24.0

FROM base AS dist
# Patches, Prisma configuration and build tsconfig must exist at frozen install.
# The trusted builder supplies a filtered Git archive, never a developer .env.
COPY --chown=node:node . .
ENV CI=true HUSKY=0 DOTENV_CONFIG_PATH=/dev/null NODE_ENV=test ACTIVE_PROFILE=test SCHEMA_TARGET=false
ENV DATABASE_URL=postgresql://isolated:isolated@127.0.0.1:1/isolated SHADOW_DATABASE_URL=postgresql://isolated:isolated@127.0.0.1:1/isolated
RUN --mount=type=secret,id=npm_auth,target=/root/.npmrc,required=true \
    pnpm install --frozen-lockfile --ignore-scripts
RUN --mount=type=secret,id=npm_auth,target=/root/.npmrc,required=true \
    pnpm rebuild argon2 esbuild @prisma/engines prisma sharp
RUN --mount=type=secret,id=npm_auth,target=/root/.npmrc,required=true \
    pnpm exec prisma generate
RUN --mount=type=secret,id=npm_auth,target=/root/.npmrc,required=true pnpm run build

FROM dist AS dependencies
# Root hooks already ran before pruning; the runtime manifest is copied from source.
RUN node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));if(p.scripts){delete p.scripts.prepare;delete p.scripts.postinstall;}fs.writeFileSync('package.json',JSON.stringify(p));"
# Preserve the generated client/native modules, remove only development packages.
RUN --mount=type=secret,id=npm_auth,target=/root/.npmrc,required=true \
    pnpm prune --prod

FROM docker.io/library/node:${NODE_VERSION}-bookworm-slim AS final

# ----- Build-time arguments -----
ARG NODE_VERSION
ARG APP_NAME
ARG APP_VERSION
ARG CREATED
ARG REVISION

# ----- Image metadata (OCI compliant) -----
LABEL org.opencontainers.image.title="${APP_NAME}-service" \
      org.opencontainers.image.description="Omnixys ${APP_NAME}-service – Node.js ${NODE_VERSION}, built with TypeScript, version ${APP_VERSION}, based on Debian Bookworm." \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      org.opencontainers.image.vendor="Omnixys Technologies" \
      org.opencontainers.image.authors="caleb.gyamfi@omnixys.com" \
      org.opencontainers.image.base.name="node:${NODE_VERSION}-bookworm-slim" \
      org.opencontainers.image.url="https://git.omnixys.com/omnixys/${APP_NAME}-service" \
      org.opencontainers.image.source="https://git.omnixys.com/omnixys/${APP_NAME}-service" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.documentation="https://git.omnixys.com/omnixys/${APP_NAME}-service/blob/main/README.md"

# ----- Set working directory -----
WORKDIR /opt/app

# ----- Environment configuration -----
# NODE_ENV=production ensures that dev dependencies are ignored and improves runtime performance.
# TZ=UTC ensures consistent timestamps across environments.
ENV NODE_ENV=production TZ=UTC PORT=8000

# ----- Install required system packages -----
# dumb-init: lightweight init system for proper signal handling.
# wget + ca-certificates: used for health checks and secure HTTPS.
RUN apt-get update && \
    apt-get install -y --no-install-recommends dumb-init wget ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* && \
    mkdir -p /opt/app/log && chown -R node:node /opt/app

# ----- Enable pnpm (runtime) -----
RUN npm install -g pnpm@11.24.0

# ----- Switch to non-root user -----
USER node

# ----- Copy built artifacts and dependencies -----
COPY --from=dependencies --chown=node:node /home/node/node_modules ./node_modules
COPY --from=dist --chown=node:node /home/node/dist ./dist
COPY --from=dist --chown=node:node /home/node/prisma ./prisma
COPY --from=dist --chown=node:node /home/node/src/prisma/generated ./src/prisma/generated
COPY --chown=node:node package.json prisma.config.ts ./

# ----- Expose application port (per Omnixys port conventions) -----
EXPOSE 8000

# ----- Healthcheck -----
# Ensures that Docker and orchestration systems (e.g., Kubernetes) can detect unhealthy containers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8000/health/liveness || exit 1

# ----- Start command -----
# dumb-init ensures proper signal forwarding and zombie process cleanup.
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "pnpm exec prisma generate && pnpm exec prisma migrate deploy && exec node dist/main.js"]
