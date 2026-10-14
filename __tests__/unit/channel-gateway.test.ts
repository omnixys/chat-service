import type { GatewayChannelClient } from '../../dist/adapter/gateway/gateway.client.js';
import './chat-fixtures.ts';
import {
  dependency,
  logger,
  conversation,
  message,
  DeliveryStatus,
  ChannelType,
} from './chat-fixtures.ts';
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
const { InAppChannelAdapter, WhatsappChannelAdapter } =
  await import('../../dist/adapter/channels/channel-adapters.js');
const { HttpGatewayChannelClient } =
  await import('../../dist/adapter/gateway/gateway.client.js');
// @covers InAppChannelAdapter.send
await test('in-app delivery returns SENT without a provider ID', async () => {
  const adapter = new InAppChannelAdapter();
  assert.equal(adapter.channelType, ChannelType.IN_APP);
  assert.deepEqual(await adapter.send(message, conversation), {
    deliveryStatus: DeliveryStatus.SENT,
    providerMessageId: null,
  });
});
// @covers WhatsappChannelAdapter.send
await test('WhatsApp delivery uses gateway outcome without leaking gateway error/private fields', async () => {
  const send = mock.fn<GatewayChannelClient['send']>(async () => ({
    success: true,
    deliveryStatus: DeliveryStatus.DELIVERED,
    providerMessageId: 'provider-1',
    error: null,
  }));
  const adapter = new WhatsappChannelAdapter(
    dependency<GatewayChannelClient>({ send }),
  );
  const target = { ...conversation, externalAddress: '+49301234567' };
  assert.deepEqual(await adapter.send(message, target), {
    deliveryStatus: DeliveryStatus.DELIVERED,
    providerMessageId: 'provider-1',
  });
  assert.deepEqual(send.mock.calls[0]?.arguments, [message, target]);
});
await test('WhatsApp missing address is refused without contacting gateway', async () => {
  const send = mock.fn<GatewayChannelClient['send']>(async () => ({
    success: false,
    deliveryStatus: DeliveryStatus.FAILED,
    providerMessageId: null,
    error: 'unavailable',
  }));
  const adapter = new WhatsappChannelAdapter(
    dependency<GatewayChannelClient>({ send }),
  );
  await assert.rejects(
    adapter.send(message, conversation),
    /no WhatsApp recipient address/,
  );
  assert.equal(send.mock.callCount(), 0);
});
await test('WhatsApp gateway rejection propagates to the dispatcher', async () => {
  const cause = new Error('gateway failed');
  const adapter = new WhatsappChannelAdapter(
    dependency<GatewayChannelClient>({
      send: async () => {
        throw cause;
      },
    }),
  );
  await assert.rejects(
    adapter.send(message, { ...conversation, externalAddress: '+49301234567' }),
    cause,
  );
});
// @covers HttpGatewayChannelClient.send
await test('gateway send constructs the real request, uses configured timeout and normalizes accepted status', async (t) => {
  const signal = new AbortController().signal;
  const timeout = t.mock.method(AbortSignal, 'timeout', () => signal);
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      success: true,
      status: 'delivered',
      providerMessageId: 'provider-1',
    }),
  );
  const target = { ...conversation, externalAddress: '+49301234567' };
  assert.deepEqual(
    await new HttpGatewayChannelClient(logger).send(message, target),
    {
      success: true,
      deliveryStatus: DeliveryStatus.DELIVERED,
      providerMessageId: 'provider-1',
      error: null,
    },
  );
  assert.deepEqual(fetch.mock.calls[0]?.arguments, [
    'http://gateway.test/api/v1/messages/send',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-key': 'chat-unit-gateway-key',
      },
      body: JSON.stringify({
        id: message.id,
        channel: message.channel,
        recipientAddress: target.externalAddress,
        senderId: message.senderId,
        body: message.body,
        contentType: message.contentType,
        metadata: { conversationId: conversation.id },
      }),
      signal,
    },
  ]);
  assert.deepEqual(timeout.mock.calls[0]?.arguments, [17000]);
});
for (const status of [undefined, '', 'unsupported-status', 'sent', 'READ']) {
  await test(`gateway accepted status ${String(status)} has the documented default or normalization`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      Response.json({ success: true, status }),
    );
    assert.deepEqual(
      await new HttpGatewayChannelClient(logger).send(message, conversation),
      {
        success: true,
        deliveryStatus:
          status === 'READ' ? DeliveryStatus.READ : DeliveryStatus.SENT,
        providerMessageId: null,
        error: null,
      },
    );
  });
}
for (const status of [400, 401, 422, 429, 500]) {
  await test(`gateway HTTP ${status} records FAILED instead of throwing`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      Response.json(
        {
          success: false,
          error: 'provider rejected',
          providerMessageId: 'do-not-retain',
        },
        { status },
      ),
    );
    assert.deepEqual(
      await new HttpGatewayChannelClient(logger).send(message, conversation),
      {
        success: false,
        deliveryStatus: DeliveryStatus.FAILED,
        providerMessageId: null,
        error: 'provider rejected',
      },
    );
  });
}
await test('gateway unsuccessful or malformed JSON response falls back to HTTP status', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('{malformed', { status: 502 }),
  );
  assert.deepEqual(
    await new HttpGatewayChannelClient(logger).send(message, conversation),
    {
      success: false,
      deliveryStatus: DeliveryStatus.FAILED,
      providerMessageId: null,
      error: 'HTTP 502',
    },
  );
});
await test('gateway successful HTTP without success flag is still a failed delivery', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ status: 'SENT' }),
  );
  assert.deepEqual(
    await new HttpGatewayChannelClient(logger).send(message, conversation),
    {
      success: false,
      deliveryStatus: DeliveryStatus.FAILED,
      providerMessageId: null,
      error: 'HTTP 200',
    },
  );
});
for (const [cause, reason] of [
  [new DOMException('timeout', 'TimeoutError'), 'gateway_timeout'],
  [new TypeError('connect failed'), 'gateway_unreachable'],
  [new Error('provider error'), 'gateway_error: provider error'],
  ['unknown failure', 'gateway_error: unknown failure'],
] as const) {
  await test(`gateway classifies transport failure as ${reason}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- non-Error transport rejection is supported
      throw cause;
    });
    assert.deepEqual(
      await new HttpGatewayChannelClient(logger).send(message, conversation),
      {
        success: false,
        deliveryStatus: DeliveryStatus.FAILED,
        providerMessageId: null,
        error: reason,
      },
    );
  });
}
// @covers HttpGatewayChannelClient.health
for (const status of [204, 401, 503]) {
  await test(`gateway health maps HTTP ${status} and caps timeout at 5000ms`, async (t) => {
    const signal = new AbortController().signal;
    const timeout = t.mock.method(AbortSignal, 'timeout', () => signal);
    const fetch = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(null, { status }),
    );
    assert.equal(
      await new HttpGatewayChannelClient(logger).health(),
      status === 204,
    );
    assert.deepEqual(fetch.mock.calls[0]?.arguments, [
      'http://gateway.test/health',
      { signal },
    ]);
    assert.deepEqual(timeout.mock.calls[0]?.arguments, [5000]);
  });
}
await test('gateway health returns false on transport failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('down');
  });
  assert.equal(await new HttpGatewayChannelClient(logger).health(), false);
});

await test('gateway without configured API key omits the header and uses a short configured timeout', async (t) => {
  const { env } = await import('../../dist/config/env.js');
  const priorKey = env.GATEWAY_API_KEY;
  const priorTimeout = env.GATEWAY_TIMEOUT;
  Reflect.set(env, 'GATEWAY_API_KEY', '');
  Reflect.set(env, 'GATEWAY_TIMEOUT', 17);
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ success: true, status: 'SENT' }),
  );
  const timeout = t.mock.method(
    AbortSignal,
    'timeout',
    () => new AbortController().signal,
  );
  try {
    await new HttpGatewayChannelClient(logger).send(message, conversation);
    assert.deepEqual(fetch.mock.calls[0]?.arguments[1]?.headers, {
      'content-type': 'application/json',
    });
    assert.deepEqual(timeout.mock.calls[0]?.arguments, [17]);
  } finally {
    Reflect.set(env, 'GATEWAY_API_KEY', priorKey);
    Reflect.set(env, 'GATEWAY_TIMEOUT', priorTimeout);
  }
});
for (const key of ['KEYCLOAK_HEALTH_URL', 'PROMETHEUS_HEALTH_URL'] as const) {
  await test(`gateway health delegates readiness when ${key} is configured`, async (t) => {
    const { env } = await import('../../dist/config/env.js');
    const prior = env[key];
    Reflect.set(env, key, 'http://health.test');
    const fetch = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(null, { status: 503 }),
    );
    try {
      assert.equal(await new HttpGatewayChannelClient(logger).health(), true);
      assert.equal(fetch.mock.callCount(), 0);
    } finally {
      Reflect.set(env, key, prior);
    }
  });
}
