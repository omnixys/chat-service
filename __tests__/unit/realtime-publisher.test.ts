import './chat-fixtures.ts';
import { dependency, logger, realtimeEvent } from './chat-fixtures.ts';
import type { ValkeyPubSubService } from '@omnixys/cache-ts';
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
const { ValkeyRealtimePublisher } =
  await import('../../dist/adapter/realtime/valkey-realtime.publisher.js');
// @covers ValkeyRealtimePublisher.subscribe
await test('first realtime listener actually attaches to Valkey and receives its message', async () => {
  let callback: ((payload: unknown) => void) | undefined;
  const subscribe = mock.fn(
    async (
      _channel: string,
      listener: (payload: unknown) => void,
    ): Promise<void> => {
      callback = listener;
    },
  );
  const unsubscribe = mock.fn(async (_channel: string): Promise<void> => {});
  const publisher = new ValkeyRealtimePublisher(
    dependency<ValkeyPubSubService>({
      subscribe: subscribe as ValkeyPubSubService['subscribe'],
      unsubscribe,
    }),
    logger,
  );
  const received: unknown[] = [];
  const listener = publisher.subscribe('conversation:1').subscribe((event) => {
    received.push(event);
  });
  try {
    assert.equal(subscribe.mock.callCount(), 1);
    assert.ok(callback);
    callback(realtimeEvent);
    assert.deepEqual(received, [realtimeEvent]);
    assert.equal(subscribe.mock.calls[0]?.arguments[0], 'chat:conversation:1');
  } finally {
    listener.unsubscribe();
    await publisher.onModuleDestroy();
  }
});

// @covers ValkeyRealtimePublisher.publish
await test('realtime publication uses the prefixed channel and preserves the event', async () => {
  const publish = mock.fn(
    async (_channel: string, _payload: unknown): Promise<void> => {},
  );
  const publisher = new ValkeyRealtimePublisher(
    dependency<ValkeyPubSubService>({ publish }),
    logger,
  );
  await publisher.publish('user:1', realtimeEvent);
  assert.deepEqual(publish.mock.calls[0]?.arguments, [
    'chat:user:1',
    realtimeEvent,
  ]);
  const cause = new Error('publish failed');
  publish.mock.mockImplementationOnce(async () => {
    throw cause;
  });
  await assert.rejects(publisher.publish('user:1', realtimeEvent), cause);
});
await test('two subscribers share a backend listener and only the last departure unsubscribes it', async () => {
  const subscribe = mock.fn(
    async (
      _channel: string,
      _listener: (payload: unknown) => void,
    ): Promise<void> => {},
  );
  const unsubscribe = mock.fn(async (_channel: string): Promise<void> => {});
  const publisher = new ValkeyRealtimePublisher(
    dependency<ValkeyPubSubService>({
      subscribe: subscribe as ValkeyPubSubService['subscribe'],
      unsubscribe,
    }),
    logger,
  );
  const first = publisher.subscribe('conversation:1').subscribe();
  const second = publisher.subscribe('conversation:1').subscribe();
  assert.equal(subscribe.mock.callCount(), 1);
  first.unsubscribe();
  assert.equal(unsubscribe.mock.callCount(), 0);
  second.unsubscribe();
  await publisher.onModuleDestroy();
  assert.equal(unsubscribe.mock.callCount(), 1);
});
await test('cancellation during registration releases the backend after registration completes', async () => {
  const registered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const order: string[] = [];
  const subscribe = mock.fn(async (): Promise<void> => {
    order.push('start');
    await registered.promise;
    order.push('registered');
  });
  const unsubscribe = mock.fn(async (): Promise<void> => {
    order.push('released');
    released.resolve();
  });
  const publisher = new ValkeyRealtimePublisher(
    dependency<ValkeyPubSubService>({ subscribe, unsubscribe }),
    logger,
  );
  const listener = publisher.subscribe('conversation:1').subscribe();
  listener.unsubscribe();
  assert.equal(unsubscribe.mock.callCount(), 0);
  registered.resolve();
  await released.promise;
  await publisher.onModuleDestroy();
  assert.deepEqual(order, ['start', 'registered', 'released']);
});
await test('a replacement subscriber waits for old release before attaching and remains active', async () => {
  const releasing = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const secondAttached = Promise.withResolvers<void>();
  const subscribe = mock.fn(async (): Promise<void> => {});
  subscribe.mock.mockImplementationOnce(async () => {});
  subscribe.mock.mockImplementationOnce(async () => {
    secondAttached.resolve();
  }, 1);
  const unsubscribe = mock.fn(async (): Promise<void> => {});
  unsubscribe.mock.mockImplementationOnce(async () => {
    releasing.resolve();
    await released.promise;
  });
  const publisher = new ValkeyRealtimePublisher(
    dependency<ValkeyPubSubService>({ subscribe, unsubscribe }),
    logger,
  );
  const first = publisher.subscribe('conversation:1').subscribe();
  first.unsubscribe();
  await releasing.promise;
  const second = publisher.subscribe('conversation:1').subscribe();
  assert.equal(subscribe.mock.callCount(), 1);
  released.resolve();
  await secondAttached.promise;
  assert.equal(subscribe.mock.callCount(), 2);
  assert.equal(second.closed, false);
  second.unsubscribe();
  await publisher.onModuleDestroy();
  assert.equal(unsubscribe.mock.callCount(), 2);
});
await test('Valkey registration failure reaches observers and a new subscription can retry', async () => {
  const cause = new Error('subscribe unavailable');
  const failed = Promise.withResolvers<unknown>();
  const released = Promise.withResolvers<void>();
  const subscribe = mock.fn(async (): Promise<void> => {});
  subscribe.mock.mockImplementationOnce(async () => {
    throw cause;
  });
  const unsubscribe = mock.fn(async (): Promise<void> => {
    released.resolve();
  });
  const publisher = new ValkeyRealtimePublisher(
    dependency<ValkeyPubSubService>({ subscribe, unsubscribe }),
    logger,
  );
  const first = publisher.subscribe('conversation:1').subscribe({
    error: (error: unknown) => {
      failed.resolve(error);
    },
  });
  assert.equal(await failed.promise, cause);
  assert.equal(first.closed, true);
  await released.promise;
  const ready = Promise.withResolvers<void>();
  subscribe.mock.mockImplementationOnce(async () => {
    ready.resolve();
  });
  const second = publisher.subscribe('conversation:1').subscribe();
  await ready.promise;
  assert.equal(subscribe.mock.callCount(), 2);
  second.unsubscribe();
  await publisher.onModuleDestroy();
});
// @covers ValkeyRealtimePublisher.health
for (const healthy of [true, false]) {
  await test(`realtime health forwards backend healthy=${healthy}`, async () => {
    const publisher = new ValkeyRealtimePublisher(
      dependency<ValkeyPubSubService>({
        health: async () => ({ healthy, status: 'ready' }),
      }),
      logger,
    );
    assert.equal(await publisher.health(), healthy);
  });
}
await test('realtime health backend error remains observable', async () => {
  const cause = new Error('health unavailable');
  const publisher = new ValkeyRealtimePublisher(
    dependency<ValkeyPubSubService>({
      health: async () => {
        throw cause;
      },
    }),
    logger,
  );
  await assert.rejects(publisher.health(), cause);
});
// @covers ValkeyRealtimePublisher.onModuleDestroy
await test('shutdown completes observers, waits for releases and handles empty/idempotent shutdown', async () => {
  const subscribe = mock.fn(async (): Promise<void> => {});
  const unsubscribe = mock.fn(async (): Promise<void> => {});
  const publisher = new ValkeyRealtimePublisher(
    dependency<ValkeyPubSubService>({ subscribe, unsubscribe }),
    logger,
  );
  const complete = mock.fn((): void => {});
  const first = publisher.subscribe('conversation:1').subscribe({ complete });
  const second = publisher.subscribe('user:1').subscribe({ complete });
  await publisher.onModuleDestroy();
  assert.equal(complete.mock.callCount(), 2);
  assert.equal(first.closed, true);
  assert.equal(second.closed, true);
  assert.equal(unsubscribe.mock.callCount(), 2);
  await publisher.onModuleDestroy();
  assert.equal(unsubscribe.mock.callCount(), 2);
});
await test('malformed non-object events are ignored and backend release rejection does not leave local observers open', async () => {
  let callback: ((payload: unknown) => void) | undefined;
  const subscribe = mock.fn(
    async (
      _channel: string,
      listener: (payload: unknown) => void,
    ): Promise<void> => {
      callback = listener;
    },
  );
  const unsubscribe = mock.fn(async (): Promise<void> => {
    throw new Error('release failed');
  });
  const publisher = new ValkeyRealtimePublisher(
    dependency<ValkeyPubSubService>({
      subscribe: subscribe as ValkeyPubSubService['subscribe'],
      unsubscribe,
    }),
    logger,
  );
  const received: unknown[] = [];
  const listener = publisher.subscribe('user:1').subscribe((event) => {
    received.push(event);
  });
  assert.ok(callback);
  callback(null);
  callback('not-json');
  callback(42);
  assert.deepEqual(received, []);
  listener.unsubscribe();
  await publisher.onModuleDestroy();
  assert.equal(listener.closed, true);
});
