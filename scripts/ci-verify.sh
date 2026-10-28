#!/usr/bin/env bash
set -euo pipefail
export DOTENV_CONFIG_PATH=/dev/null NODE_ENV=test HUSKY=0 PYTHON_DOTENV_DISABLED=1
export DATABASE_URL=postgresql://isolated:isolated@127.0.0.1:1/isolated
export SHADOW_DATABASE_URL=postgresql://isolated:isolated@127.0.0.1:1/isolated_shadow
export ACTIVE_PROFILE=test SPRING_PROFILES_ACTIVE=test SCHEMA_TARGET=false
pnpm install --frozen-lockfile --ignore-scripts
node --test scripts/forgejo-service-release.test.mjs
pnpm peers check
pnpm rebuild argon2 esbuild @prisma/engines prisma
pnpm exec prisma generate
pnpm build
pnpm format:check
pnpm run lint:check
pnpm exec tsc -p tsconfig.json --noEmit
pnpm test:unit
pnpm test:typecheck
git diff --exit-code -- package.json pnpm-lock.yaml
