import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DOTENV_CONFIG_PATH: '/dev/null',
  KEYCLOAK_HEALTH_URL: '',
  TEMPO_HEALTH_URL: '',
  PROMETHEUS_HEALTH_URL: '',
});
const { HealthController } =
  await import('../../dist/health/health.controller.js');
const { env } = await import('../../dist/config/env.js');

function setup(context) {
  context.mock.method(Date, 'now', () => 1000);
  const previous = [
    env.KEYCLOAK_HEALTH_URL,
    env.TEMPO_HEALTH_URL,
    env.PROMETHEUS_HEALTH_URL,
  ];
  env.KEYCLOAK_HEALTH_URL = '';
  env.TEMPO_HEALTH_URL = '';
  env.PROMETHEUS_HEALTH_URL = '';
  context.after(() => {
    [env.KEYCLOAK_HEALTH_URL, env.TEMPO_HEALTH_URL, env.PROMETHEUS_HEALTH_URL] =
      previous;
  });
  const result = { status: 'ok', details: {} };
  const probes = [];
  const health = {
    check: mock.fn(async (checks) => {
      probes.push(...(await Promise.all(checks.map((check) => check()))));
      return result;
    }),
  };
  const prisma = { $queryRaw: mock.fn(async () => [{ result: 1 }]) };
  const cache = {
    health: mock.fn(async () => ({
      healthy: true,
      status: 'connected',
      latencyMs: 4,
    })),
  };
  const pubSub = {
    health: mock.fn(async () => ({ healthy: true, status: 'connected' })),
  };
  const kafka = {
    isHealthy: mock.fn(async () => ({ kafka: { status: 'up' } })),
  };
  const realtime = { health: mock.fn(async () => true) };
  const gateway = { health: mock.fn(async () => true) };
  const fetch = context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected outbound request');
  });
  return {
    result,
    probes,
    health,
    prisma,
    cache,
    pubSub,
    kafka,
    realtime,
    gateway,
    fetch,
    controller: new HealthController(
      health,
      prisma,
      cache,
      pubSub,
      kafka,
      realtime,
      gateway,
    ),
  };
}

// @covers HealthController.liveness
test('liveness avoids every external dependency', async (context) => {
  const state = setup(context);
  assert.equal(await state.controller.liveness(), state.result);
  assert.deepEqual(state.probes, [{ app: { status: 'up' } }]);
  for (const probe of [
    state.prisma.$queryRaw,
    state.cache.health,
    state.pubSub.health,
    state.kafka.isHealthy,
    state.realtime.health,
    state.gateway.health,
    state.fetch,
  ]) {
    assert.equal(probe.mock.callCount(), 0);
  }
});

// @covers HealthController.readiness
test('readiness checks all transports and skips unconfigured HTTP endpoints', async (context) => {
  const state = setup(context);
  assert.equal(await state.controller.readiness(), state.result);
  assert.deepEqual(state.probes, [
    { app: { status: 'up' } },
    { database: { status: 'up', latencyMs: 0 } },
    { cache: { status: 'up', connectionStatus: 'connected', latencyMs: 4 } },
    { kafka: { status: 'up' } },
    { realtime: { status: 'up', connectionStatus: 'connected' } },
    { gateway: { status: 'up' } },
    { keycloak: { status: 'up', skipped: true } },
    { tempo: { status: 'up', skipped: true } },
    { prometheus: { status: 'up', skipped: true } },
  ]);
  assert.deepEqual(
    [...state.prisma.$queryRaw.mock.calls[0].arguments[0]],
    ['SELECT 1'],
  );
  assert.equal(state.fetch.mock.callCount(), 0);
});

for (const cause of [
  new Error('database unavailable'),
  'database unavailable',
]) {
  test(`readiness projects a database failure of type ${typeof cause}`, async (context) => {
    const state = setup(context);
    state.prisma.$queryRaw.mock.mockImplementation(async () => {
      throw cause;
    });
    await state.controller.readiness();
    assert.deepEqual(state.probes[1], {
      database: { status: 'down', error: 'database unavailable' },
    });
    assert.equal(state.gateway.health.mock.callCount(), 1);
  });
}

test('readiness maps degraded cache connection details', async (context) => {
  const state = setup(context);
  state.cache.health.mock.mockImplementation(async () => ({
    healthy: false,
    status: 'disconnected',
    latencyMs: 9,
  }));
  await state.controller.readiness();
  assert.deepEqual(state.probes[2], {
    cache: { status: 'down', connectionStatus: 'disconnected', latencyMs: 9 },
  });
});

for (const realtime of [false, true]) {
  for (const pubSub of [false, true]) {
    test(`readiness requires both realtime=${realtime} and pubsub=${pubSub}`, async (context) => {
      const state = setup(context);
      state.realtime.health.mock.mockImplementation(async () => realtime);
      state.pubSub.health.mock.mockImplementation(async () => ({
        healthy: pubSub,
        status: pubSub ? 'connected' : 'disconnected',
      }));
      await state.controller.readiness();
      assert.deepEqual(state.probes[4], {
        realtime: {
          status: realtime && pubSub ? 'up' : 'down',
          connectionStatus: pubSub ? 'connected' : 'disconnected',
        },
      });
    });
  }
}

test('readiness reports a failed gateway response', async (context) => {
  const state = setup(context);
  state.gateway.health.mock.mockImplementation(async () => false);
  await state.controller.readiness();
  assert.deepEqual(state.probes[5], { gateway: { status: 'down' } });
});
for (const cause of [new Error('gateway unavailable'), 'gateway unavailable']) {
  test(`readiness projects a gateway exception of type ${typeof cause}`, async (context) => {
    const state = setup(context);
    state.gateway.health.mock.mockImplementation(async () => {
      throw cause;
    });
    await state.controller.readiness();
    assert.deepEqual(state.probes[5], {
      gateway: { status: 'down', error: 'gateway unavailable' },
    });
  });
}

for (const [dependency, method] of [
  ['cache', 'health'],
  ['pubSub', 'health'],
  ['realtime', 'health'],
  ['kafka', 'isHealthy'],
  ['health', 'check'],
]) {
  test(`readiness preserves an unexpected ${dependency} failure`, async (context) => {
    const state = setup(context);
    const cause = new Error('probe failed');
    state[dependency][method].mock.mockImplementation(async () => {
      throw cause;
    });
    await assert.rejects(
      state.controller.readiness(),
      (error) => error === cause,
    );
  });
}

for (const [name, configuration, index] of [
  ['keycloak', 'KEYCLOAK_HEALTH_URL', 6],
  ['tempo', 'TEMPO_HEALTH_URL', 7],
  ['prometheus', 'PROMETHEUS_HEALTH_URL', 8],
]) {
  for (const status of [200, 503]) {
    test(`readiness maps ${name} HTTP status ${status} and enforces its timeout`, async (context) => {
      const state = setup(context);
      env[configuration] = `http://127.0.0.1:1/${name}`;
      const signal = new AbortController().signal;
      const timeout = context.mock.method(AbortSignal, 'timeout', () => signal);
      state.fetch.mock.mockImplementation(
        async () => new Response(null, { status }),
      );
      await state.controller.readiness();
      assert.deepEqual(state.probes[index], {
        [name]: {
          status: status === 200 ? 'up' : 'down',
          statusCode: status,
          latencyMs: 0,
        },
      });
      assert.deepEqual(timeout.mock.calls[0].arguments, [3000]);
      assert.deepEqual(state.fetch.mock.calls[0].arguments, [
        env[configuration],
        { method: 'GET', signal },
      ]);
    });
  }
  for (const cause of [new Error('HTTP unavailable'), 'HTTP unavailable']) {
    test(`readiness projects ${name} HTTP failures of type ${typeof cause}`, async (context) => {
      const state = setup(context);
      env[configuration] = `http://127.0.0.1:1/${name}`;
      context.mock.method(
        AbortSignal,
        'timeout',
        () => new AbortController().signal,
      );
      state.fetch.mock.mockImplementation(async () => {
        throw cause;
      });
      await state.controller.readiness();
      assert.deepEqual(state.probes[index], {
        [name]: { status: 'down', error: 'HTTP unavailable', latencyMs: 0 },
      });
    });
  }
}
