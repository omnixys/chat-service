import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const tsconfigTest = JSON.parse(
  readFileSync(new URL('./tsconfig.test.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

export default defineConfig({
  resolve: {
    // chat links @omnixys/kafka-ts (and contracts-ts) from the local
    // workspace, which resolves its own @nestjs/core. Force a single copy so
    // NestJS DI tokens (Reflector, DiscoveryService, ...) stay identical.
    dedupe: ['@nestjs/core', '@nestjs/common'],
  },

  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.e2e-spec.ts'],
    globalSetup: ['__tests__/e2e/global-setup.ts'],
    globalTeardown: ['__tests__/e2e/global-teardown.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    teardownTimeout: 30000,
    isolate: true,
    fileParallelism: false,
    setupFiles: ['reflect-metadata', '__tests__/e2e/setup-env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
    },
  },

  esbuild: {
    tsconfigRaw: tsconfigTest,
  },
});
