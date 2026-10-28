import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
Object.assign(process.env, {
  NODE_ENV: 'test',
  DOTENV_CONFIG_PATH: '/dev/null',
});
const { ValkeyRateLimitStore } =
  await import('../../dist/adapter/valkey-rate-limit-store.adapter.js');
function setup() {
  const valkey = {
    increment: mock.fn(async () => 2),
    expire: mock.fn(async () => true),
    ttl: mock.fn(async () => 10),
  };
  return { valkey, subject: new ValkeyRateLimitStore(valkey) };
}
// @covers ValkeyRateLimitStore.incr
// @covers ValkeyRateLimitStore.ttl
// @covers ValkeyRateLimitStore.expire
const cases = [
  ['incr', ['bucket'], 'increment', ['bucket'], 2],
  ['ttl', ['bucket'], 'ttl', ['bucket'], 10],
  ['expire', ['bucket', 60], 'expire', ['bucket', 60], undefined],
];
for (const [method, arguments_, dependency, forwarded, returned] of cases) {
  test(`ValkeyRateLimitStore.${method} forwards arguments and preserves its contract result`, async () => {
    const state = setup();
    assert.equal(await state.subject[method](...arguments_), returned);
    assert.deepEqual(
      state.valkey[dependency].mock.calls.map((call) => call.arguments),
      [forwarded],
    );
  });
  test(`ValkeyRateLimitStore.${method} propagates cache failure`, async () => {
    const state = setup();
    const failure = new Error('cache unavailable');
    state.valkey[dependency].mock.mockImplementation(async () => {
      throw failure;
    });
    await assert.rejects(
      state.subject[method](...arguments_),
      (error) => error === failure,
    );
    assert.deepEqual(
      state.valkey[dependency].mock.calls[0].arguments,
      forwarded,
    );
  });
}
