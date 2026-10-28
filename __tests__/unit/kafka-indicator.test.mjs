import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
Object.assign(process.env, {
  NODE_ENV: 'test',
  DOTENV_CONFIG_PATH: '/dev/null',
});
const { KafkaIndicator } = await import('../../dist/health/kafka.indicator.js');
// @covers KafkaIndicator.isHealthy
for (const healthy of [true, false]) {
  test(`KafkaIndicator.isHealthy projects lifecycle healthy=${healthy} with component status`, async () => {
    const snapshot = {
      healthy,
      producer: { status: healthy ? 'ready' : 'degraded' },
      consumer: { status: 'ready' },
    };
    const health = mock.fn(() => snapshot);
    const error = mock.fn();
    const indicator = new KafkaIndicator(
      { health },
      { log: () => ({ error }) },
    );
    assert.deepEqual(await indicator.isHealthy(), {
      kafka: {
        status: healthy ? 'up' : 'down',
        producer: snapshot.producer.status,
        consumer: snapshot.consumer.status,
      },
    });
    assert.deepEqual(health.mock.calls[0].arguments, []);
    assert.equal(health.mock.callCount(), 1);
    assert.deepEqual(
      error.mock.calls.map((call) => call.arguments),
      healthy ? [] : [['Kafka health check failed: %o', { health: snapshot }]],
    );
  });
}
test('KafkaIndicator.isHealthy preserves an unexpected lifecycle error', async () => {
  const failure = new Error('lifecycle unavailable');
  const error = mock.fn();
  const indicator = new KafkaIndicator(
    {
      health: () => {
        throw failure;
      },
    },
    { log: () => ({ error }) },
  );
  await assert.rejects(
    Promise.resolve().then(() => indicator.isHealthy()),
    (cause) => cause === failure,
  );
  assert.equal(error.mock.callCount(), 0);
});
