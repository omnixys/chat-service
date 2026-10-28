import { strict as assert } from 'node:assert';
import test from 'node:test';

/**
 * The guard fails closed when no internal key is configured.
 *
 * This file deliberately leaves `INTERNAL_GATEWAY_TOKEN` unset: the configured-key
 * case is covered in `chat-internal-key-configured.test.mjs`, and both need their
 * own process because `env` is resolved once at module load.
 */
delete process.env['INTERNAL_GATEWAY_TOKEN'];

const { InternalApiKeyGuard } =
  await import('../../dist/chat/controllers/internal-api-key.guard.js');

const guard = new InternalApiKeyGuard();

function context(headers) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) };
}

test('an unconfigured internal key never authenticates a request', () => {
  assert.throws(
    () => guard.canActivate(context({ 'x-api-key': 'anything' })),
    (error) => error.status === 401,
    'a misconfigured service must answer 401 instead of 204',
  );
});

test('an unconfigured internal key answers 401 without a header as well', () => {
  assert.throws(
    () => guard.canActivate(context({})),
    (error) => error.status === 401,
  );
});
