import { strict as assert } from 'node:assert';
import test from 'node:test';

/**
 * The configured-key case of the internal API key guard.
 *
 * The key is set before the first import because `env` is resolved once per
 * process; the unconfigured case lives in `chat-internal-key-unconfigured.test.mjs`.
 */
process.env['INTERNAL_GATEWAY_TOKEN'] = 'test-internal-key';

const { InternalApiKeyGuard } =
  await import('../../dist/chat/controllers/internal-api-key.guard.js');

const guard = new InternalApiKeyGuard();

function context(headers) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) };
}

test('the configured internal key authenticates', () => {
  assert.equal(
    guard.canActivate(context({ 'x-api-key': 'test-internal-key' })),
    true,
  );
});

test('a wrong internal key is rejected with 401', () => {
  assert.throws(
    () => guard.canActivate(context({ 'x-api-key': 'wrong-key' })),
    (error) => error.status === 401,
    'a wrong key must never be reported as allowed',
  );
});

test('a missing internal key is rejected with 401', () => {
  assert.throws(
    () => guard.canActivate(context({})),
    (error) => error.status === 401,
  );
});

test('a repeated header value is compared against the configured key', () => {
  assert.equal(
    guard.canActivate(context({ 'x-api-key': ['test-internal-key'] })),
    true,
  );
  assert.throws(
    () =>
      guard.canActivate(
        context({ 'x-api-key': ['wrong', 'test-internal-key'] }),
      ),
    (error) => error.status === 401,
  );
});

test('a key of a different length is rejected without a timing shortcut', () => {
  assert.throws(
    () => guard.canActivate(context({ 'x-api-key': 'short' })),
    (error) => error.status === 401,
  );
});
