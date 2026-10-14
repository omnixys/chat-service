import { applyE2eEnv } from '../../../test-tools/e2e/infrastructure.mjs';
import { inject } from 'vitest';

const env = inject<Record<string, string | number | boolean> | undefined>(
  'omnixys-e2e',
);

if (env) {
  applyE2eEnv(env);
}
