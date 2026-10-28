import type { AnalyticsEventPublisher } from '../../dist/analytics/analytics-outbox.js';
import type { ChatDatabase } from '../../dist/chat/persistence/prisma-chat.repository.js';
import './chat-fixtures.ts';
import {
  dependency,
  logger,
  NOW,
  TENANT,
  USER,
  message,
} from './chat-fixtures.ts';
import type { KafkaProducerService } from '@omnixys/kafka-ts';
import assert from 'node:assert/strict';
import test, { mock, type Mock } from 'node:test';
const crypto = await import('node:crypto');
mock.module('node:crypto', {
  namedExports: { ...crypto, randomUUID: () => message.id },
  defaultExport: { ...crypto.default, randomUUID: () => message.id },
});
const { AnalyticsOutboxPublisher } =
  await import('../../dist/analytics/analytics-outbox.js');
const { KafkaAnalyticsEventPublisher } =
  await import('../../dist/analytics/kafka-analytics.publisher.js');
const { env } = await import('../../dist/config/env.js');
interface OutboxHarness {
  subject: InstanceType<typeof AnalyticsOutboxPublisher>;
  findMany: Mock<(_input: unknown) => Promise<unknown[]>>;
  updateMany: Mock<(_input: unknown) => Promise<{ count: number }>>;
  findUnique: Mock<(_input: unknown) => Promise<{ attempts: number } | null>>;
  update: Mock<(_input: unknown) => Promise<unknown>>;
  publish: Mock<AnalyticsEventPublisher['publish']>;
}
function harness(rows: unknown[] = []): OutboxHarness {
  const findMany = mock.fn(async (_input: unknown): Promise<unknown[]> => rows);
  const updateMany = mock.fn(async (_input: unknown) => ({ count: 1 }));
  const findUnique = mock.fn(
    async (_input: unknown): Promise<{ attempts: number } | null> => ({
      attempts: 0,
    }),
  );
  const update = mock.fn(async (_input: unknown): Promise<unknown> => ({
    id: message.id,
  }));
  const publish = mock.fn<AnalyticsEventPublisher['publish']>(async () => {});
  const db = dependency<ChatDatabase>({
    analyticsOutbox: dependency<ChatDatabase['analyticsOutbox']>({
      findMany: findMany as ChatDatabase['analyticsOutbox']['findMany'],
      updateMany: updateMany as ChatDatabase['analyticsOutbox']['updateMany'],
      findUnique: findUnique as ChatDatabase['analyticsOutbox']['findUnique'],
      update: update as ChatDatabase['analyticsOutbox']['update'],
    }),
  });
  return {
    subject: new AnalyticsOutboxPublisher(db, { publish }, logger),
    findMany,
    updateMany,
    findUnique,
    update,
    publish,
  };
}
const row = {
  id: message.id,
  tenantId: TENANT,
  topic: 'chat.message.sent.v1',
  payload: { eventName: 'message.sent' },
};
// @covers AnalyticsOutboxPublisher.drainOnce
await test('outbox selects due unpublished rows in bounded order and conditionally locks before publishing', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const h = harness([row]);
  assert.equal(await h.subject.drainOnce(7, 3), 1);
  assert.deepEqual(h.findMany.mock.calls[0]?.arguments, [
    {
      where: {
        publishedAt: null,
        deadLetteredAt: null,
        nextAttemptAt: { lte: NOW },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: 7,
    },
  ]);
  assert.deepEqual(h.updateMany.mock.calls[0]?.arguments, [
    {
      where: { id: message.id, lockedAt: null },
      data: { lockedAt: NOW, lockedBy: message.id },
    },
  ]);
  assert.deepEqual(h.publish.mock.calls[0]?.arguments, [
    row.topic,
    row.payload,
  ]);
  assert.deepEqual(h.update.mock.calls[0]?.arguments, [
    {
      where: { id: message.id },
      data: {
        publishedAt: NOW,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    },
  ]);
});
await test('outbox drain rejects a second concurrent drain and unlocks the local drain flag after completion', async () => {
  const h = harness([row]);
  const finish = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  h.publish.mock.mockImplementationOnce(async () => {
    entered.resolve();
    await finish.promise;
  });
  const first = h.subject.drainOnce(7, 3);
  await entered.promise;
  assert.equal(await h.subject.drainOnce(7, 3), 0);
  assert.equal(h.findMany.mock.callCount(), 1);
  finish.resolve();
  assert.equal(await first, 1);
  assert.equal(await h.subject.drainOnce(7, 3), 1);
});
for (const stage of [
  'select',
  'lock',
  'record-read',
  'record-write',
] as const) {
  await test(`outbox ${stage} failure remains observable and permits another drain`, async () => {
    const h = harness([row]);
    const cause = new Error(`${stage} failed`);
    if (stage === 'select') {
      h.findMany.mock.mockImplementationOnce(async () => {
        throw cause;
      });
    } else if (stage === 'lock') {
      h.updateMany.mock.mockImplementationOnce(async () => {
        throw cause;
      });
    } else {
      h.publish.mock.mockImplementationOnce(async () => {
        throw new Error('publish unavailable');
      });
      if (stage === 'record-read') {
        h.findUnique.mock.mockImplementationOnce(async () => {
          throw cause;
        });
      } else {
        h.update.mock.mockImplementationOnce(async () => {
          throw cause;
        });
      }
    }
    await assert.rejects(h.subject.drainOnce(7, 3), cause);
    assert.equal(await h.subject.drainOnce(7, 3), 1);
  });
}
for (const payload of [null, 1, 'event', undefined]) {
  await test(`outbox scalar payload ${String(payload)} is wrapped at the publisher boundary`, async () => {
    const h = harness([{ ...row, payload }]);
    await h.subject.drainOnce(7, 3);
    assert.deepEqual(h.publish.mock.calls[0]?.arguments, [
      row.topic,
      { value: payload },
    ]);
  });
}
for (const [attempts, expectedDelay] of [
  [0, 1000],
  [1, 2000],
  [9, 300000],
] as const) {
  await test(`outbox retry ${attempts + 1} has exact exponential delay capped at five minutes`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
    const h = harness([row]);
    h.findUnique.mock.mockImplementationOnce(async () => ({ attempts }));
    h.publish.mock.mockImplementationOnce(async () => {
      throw new Error('x'.repeat(600));
    });
    await h.subject.drainOnce(7, 99);
    assert.deepEqual(h.update.mock.calls[0]?.arguments, [
      {
        where: { id: message.id },
        data: {
          attempts: attempts + 1,
          lockedAt: null,
          lockedBy: null,
          lastError: 'x'.repeat(500),
          nextAttemptAt: new Date(NOW.getTime() + expectedDelay),
        },
      },
    ]);
  });
}
await test('outbox missing attempts row starts at one and reaching max attempts marks the exact dead-letter date', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const h = harness([row]);
  h.findUnique.mock.mockImplementationOnce(async () => null);
  h.publish.mock.mockImplementationOnce(async () => {
    throw new Error('publish unavailable');
  });
  await h.subject.drainOnce(7, 1);
  assert.deepEqual(h.update.mock.calls[0]?.arguments, [
    {
      where: { id: message.id },
      data: {
        attempts: 1,
        lockedAt: null,
        lockedBy: null,
        lastError: 'publish unavailable',
        nextAttemptAt: new Date(NOW.getTime() + 1000),
        deadLetteredAt: NOW,
      },
    },
  ]);
});
await test('failure to mark published schedules a retry and continues with the next row', async () => {
  const h = harness([row, { ...row, id: 'next-row' }]);
  h.update.mock.mockImplementationOnce(async () => {
    throw new Error('mark published failed');
  });
  assert.equal(await h.subject.drainOnce(7, 3), 2);
  assert.equal(h.publish.mock.callCount(), 2);
  assert.equal(h.update.mock.callCount(), 3);
  assert.equal(h.findUnique.mock.callCount(), 1);
});
// @covers AnalyticsOutboxPublisher.start
// @covers AnalyticsOutboxPublisher.stop
// @covers AnalyticsOutboxPublisher.onApplicationBootstrap
// @covers AnalyticsOutboxPublisher.onApplicationShutdown
await test('outbox lifecycle configures one unref timer, repeated start is idempotent and stop permits restart', async (t) => {
  const h = harness();
  const callbacks: Array<() => void> = [];
  const token = dependency<NodeJS.Timeout>({});
  const unref = mock.fn((): NodeJS.Timeout => token);
  token.unref = unref;
  const interval = t.mock.method(
    globalThis,
    'setInterval',
    (callback: () => void, _ms: number) => {
      callbacks.push(callback);
      return token;
    },
  );
  const clear = t.mock.method(globalThis, 'clearInterval', () => {});
  h.subject.onApplicationBootstrap();
  assert.deepEqual(interval.mock.calls[0]?.arguments.slice(1), [10000]);
  assert.equal(unref.mock.callCount(), 1);
  h.subject.start(1, 99, 99);
  assert.equal(interval.mock.callCount(), 1);
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  h.findMany.mock.mockImplementationOnce(async () => {
    started.resolve();
    await finish.promise;
    return [];
  });
  const callback = callbacks[0];
  assert.ok(callback);
  callback();
  await started.promise;
  assert.equal(
    (h.findMany.mock.calls[0]?.arguments[0] as { take: number }).take,
    7,
  );
  finish.resolve();
  h.subject.onApplicationShutdown();
  h.subject.stop();
  assert.equal(clear.mock.callCount(), 1);
  h.subject.start(3, 7, 3);
  assert.equal(interval.mock.callCount(), 2);
  h.subject.stop();
  assert.equal(clear.mock.callCount(), 2);
});
await test('disabled outbox startup does not schedule a timer', () => {
  const original = env.ANALYTICS_OUTBOX_ENABLED;
  Reflect.set(env, 'ANALYTICS_OUTBOX_ENABLED', false);
  const h = harness();
  const start = mock.method(h.subject, 'start');
  try {
    h.subject.onApplicationBootstrap();
    assert.equal(start.mock.callCount(), 0);
  } finally {
    Reflect.set(env, 'ANALYTICS_OUTBOX_ENABLED', original);
    start.mock.restore();
  }
});
// @covers KafkaAnalyticsEventPublisher.publish
await test('Kafka analytics publisher sends the exact raw envelope and allowlisted headers', async () => {
  const rawSend = mock.fn(
    async (
      _topic: string,
      _payload: string,
      _headers: Record<string, string>,
    ): Promise<void> => {},
  );
  const publisher = new KafkaAnalyticsEventPublisher(
    dependency<KafkaProducerService>({
      rawSend,
    }),
  );
  const payload = {
    id: 'event-1',
    eventName: 'message.sent',
    tenantId: TENANT,
    actorId: USER,
    correlationId: 'correlation-1',
    occurredAt: NOW.toISOString(),
    properties: { bodyLength: 5 },
  };
  await publisher.publish(row.topic, payload);
  assert.deepEqual(rawSend.mock.calls[0]?.arguments, [
    row.topic,
    JSON.stringify({
      eventId: 'event-1',
      eventName: 'message.sent',
      eventType: 'EVENT',
      eventVersion: '1',
      service: 'chat-unit',
      timestamp: NOW.toISOString(),
      payload,
    }),
    {
      'x-tenant-id': TENANT,
      'x-event-id': 'event-1',
      'x-event-version': '1',
      'x-event-type': 'EVENT',
      'x-service': 'chat-unit',
      'x-correlation-id': 'correlation-1',
      'x-actor-id': USER,
    },
  ]);
});
await test('Kafka analytics publisher applies actual identity/time defaults and omits absent optional headers', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const rawSend = mock.fn(
    async (
      _topic: string,
      _payload: string,
      _headers: Record<string, string>,
    ): Promise<void> => {},
  );
  await new KafkaAnalyticsEventPublisher(
    dependency<KafkaProducerService>({
      rawSend,
    }),
  ).publish(row.topic, {
    id: '',
    eventName: 1,
    tenantId: '',
    occurredAt: false,
  });
  const args = rawSend.mock.calls[0]?.arguments;
  assert.ok(args);
  assert.deepEqual(JSON.parse(args[1]), {
    eventId: 'chat-unit',
    eventName: row.topic,
    eventType: 'EVENT',
    eventVersion: '1',
    service: 'chat-unit',
    timestamp: NOW.toISOString(),
    payload: { id: '', eventName: 1, tenantId: '', occurredAt: false },
  });
  assert.deepEqual(args[2], {
    'x-tenant-id': '',
    'x-event-id': 'chat-unit',
    'x-event-version': '1',
    'x-event-type': 'EVENT',
    'x-service': 'chat-unit',
  });
});
await test('Kafka analytics publication failure propagates for outbox retry', async () => {
  const cause = new Error('broker unavailable');
  const publisher = new KafkaAnalyticsEventPublisher(
    dependency<KafkaProducerService>({
      rawSend: async () => {
        throw cause;
      },
    }),
  );
  await assert.rejects(publisher.publish(row.topic, {}), cause);
});
