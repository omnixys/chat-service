import type {
  ChannelAdapter,
  DeliveryPolicy,
} from '../../dist/adapter/channels/channel.port.js';
import type { RealtimePublisher } from '../../dist/adapter/realtime/realtime.port.js';
import './chat-fixtures.ts';
import {
  dependency,
  logger,
  conversation,
  message,
  realtimeEvent,
  TENANT,
  USER,
  PEER,
  NOW,
  DeliveryStatus,
  ChannelType,
} from './chat-fixtures.ts';
import { serviceHarness } from './service-fixtures.ts';
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
const crypto = await import('node:crypto');
mock.module('node:crypto', {
  namedExports: { ...crypto, randomUUID: () => message.id },
  defaultExport: { ...crypto.default, randomUUID: () => message.id },
});
const { InboundMessageService } =
  await import('../../dist/chat/services/inbound-message.service.js');
const { MessageDispatcher } =
  await import('../../dist/chat/services/message-dispatcher.service.js');
const inbound = {
  messageId: 'provider-1',
  channel: ' whatsapp ',
  userId: 'untrusted-user',
  from: '+49301234567',
  body: '  Hello  ',
  contentType: '',
  conversationId: conversation.id,
};
// @covers InboundMessageService.handle
await test('inbound derives tenant from conversation and sender from provider address, stores and emits bounded fact', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const h = serviceHarness();
  const publish = mock.fn<RealtimePublisher['publish']>(async () => {});
  const result = await new InboundMessageService(
    h.unitOfWork,
    dependency<RealtimePublisher>({ publish }),
    logger,
  ).handle(inbound);
  assert.deepEqual(result, {
    message: {
      ...message,
      senderId: 'whatsapp:+49301234567',
      body: inbound.body,
      channel: ChannelType.WHATSAPP,
      deliveryStatus: DeliveryStatus.DELIVERED,
      providerMessageId: inbound.messageId,
    },
    tenantId: TENANT,
    duplicate: false,
  });
  assert.deepEqual(h.analytics.enqueue.mock.calls[0]?.arguments, [
    {
      topic: 'chat.message.received.v1',
      eventName: 'message.received',
      aggregateId: message.id,
      aggregateType: 'chat.message',
      subjectId: result.message.senderId,
      tenantId: TENANT,
      properties: {
        conversationId: conversation.id,
        channel: ChannelType.WHATSAPP,
        contentType: 'TEXT',
        bodyLength: inbound.body.length,
      },
    },
  ]);
  assert.deepEqual(
    publish.mock.calls.map((call) => call.arguments[0]),
    [`conversation:${conversation.id}`, `user:${USER}`, `user:${PEER}`],
  );
  assert.equal(h.transaction.mock.callCount(), 2);
});
for (const patch of [
  { messageId: '' },
  { body: ' ' },
  { channel: 'SMS' },
  { contentType: 'UNKNOWN' },
  { from: 'not-e164' },
]) {
  await test(`inbound invalid fields ${JSON.stringify(patch)} fail before transaction`, async () => {
    const h = serviceHarness();
    const publish = mock.fn<RealtimePublisher['publish']>(async () => {});
    await assert.rejects(
      new InboundMessageService(
        h.unitOfWork,
        dependency<RealtimePublisher>({ publish }),
        logger,
      ).handle({ ...inbound, ...patch }),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.transaction.mock.callCount(), 0);
    assert.equal(publish.mock.callCount(), 0);
  });
}
await test('ambiguous provider ID across tenants is refused before resolving conversation or writing', async () => {
  const h = serviceHarness();
  h.messages.findByProviderMessageIdAnyTenant.mock.mockImplementationOnce(
    async () => [message, { ...message, tenantId: 'other-tenant' }],
  );
  await assert.rejects(
    new InboundMessageService(
      h.unitOfWork,
      dependency<RealtimePublisher>({ publish: async () => {} }),
      logger,
    ).handle(inbound),
    { code: 'MESSAGE_INPUT_INVALID' },
  );
  assert.equal(h.conversations.findByIdAnyTenant.mock.callCount(), 0);
  assert.equal(h.messages.save.mock.callCount(), 0);
});
await test('duplicate inbound remains idempotent even when its original conversation was deleted', async () => {
  const h = serviceHarness();
  h.messages.findByProviderMessageIdAnyTenant.mock.mockImplementationOnce(
    async () => [message],
  );
  h.conversations.findByIdAnyTenant.mock.mockImplementationOnce(
    async () => null,
  );
  const publish = mock.fn<RealtimePublisher['publish']>(async () => {});
  assert.deepEqual(
    await new InboundMessageService(
      h.unitOfWork,
      dependency<RealtimePublisher>({ publish }),
      logger,
    ).handle(inbound),
    { message, duplicate: true, tenantId: TENANT },
  );
  assert.equal(h.messages.save.mock.callCount(), 0);
  assert.equal(h.analytics.enqueue.mock.callCount(), 0);
  assert.equal(publish.mock.callCount(), 0);
});
for (const count of [0, 1, 2]) {
  await test(`inbound address-only lookup with ${count} owning conversations is ${count === 1 ? 'accepted' : 'refused'}`, async () => {
    const h = serviceHarness();
    h.conversations.findByExternalAddressAnyTenant.mock.mockImplementationOnce(
      async () =>
        Array.from({ length: count }, (_, index) => ({
          ...conversation,
          id: index === 0 ? conversation.id : 'other-conversation',
          tenantId: index === 0 ? TENANT : 'other-tenant',
        })),
    );
    const service = new InboundMessageService(
      h.unitOfWork,
      dependency<RealtimePublisher>({ publish: async () => {} }),
      logger,
    );
    const result = service.handle({ ...inbound, conversationId: null });
    if (count === 1) {
      assert.equal((await result).tenantId, TENANT);
    } else {
      await assert.rejects(result, { code: 'MESSAGE_INPUT_INVALID' });
      assert.equal(h.messages.save.mock.callCount(), 0);
    }
  });
}
await test('explicit missing conversation does not fall back to a different address owner', async () => {
  const h = serviceHarness();
  h.conversations.findByIdAnyTenant.mock.mockImplementationOnce(
    async () => null,
  );
  await assert.rejects(
    new InboundMessageService(
      h.unitOfWork,
      dependency<RealtimePublisher>({ publish: async () => {} }),
      logger,
    ).handle(inbound),
    { code: 'CONVERSATION_NOT_FOUND' },
  );
  assert.equal(
    h.conversations.findByExternalAddressAnyTenant.mock.callCount(),
    0,
  );
});
await test('missing inbound conversation and blank sender cannot select a tenant', async () => {
  const h = serviceHarness();
  await assert.rejects(
    new InboundMessageService(
      h.unitOfWork,
      dependency<RealtimePublisher>({ publish: async () => {} }),
      logger,
    ).handle({ ...inbound, conversationId: null, from: '' }),
    { code: 'MESSAGE_INPUT_INVALID', httpStatus: 422 },
  );
  assert.equal(h.messages.save.mock.callCount(), 0);
});
await test('participant lookup failure falls back to committed participant IDs without losing inbound row', async () => {
  const h = serviceHarness();
  h.conversations.getParticipantIds.mock.mockImplementationOnce(async () => {
    throw new Error('participants unavailable');
  });
  const publish = mock.fn<RealtimePublisher['publish']>(async () => {});
  const result = await new InboundMessageService(
    h.unitOfWork,
    dependency<RealtimePublisher>({ publish }),
    logger,
  ).handle(inbound);
  assert.equal(result.duplicate, false);
  assert.deepEqual(
    publish.mock.calls.map((call) => call.arguments[0]),
    [`conversation:${conversation.id}`, `user:${USER}`, `user:${PEER}`],
  );
});
await test('realtime failure after inbound commit does not turn a provider retry into a failed write', async () => {
  const h = serviceHarness();
  const publish = mock.fn<RealtimePublisher['publish']>(async () => {
    throw new Error('realtime unavailable');
  });
  const result = await new InboundMessageService(
    h.unitOfWork,
    dependency<RealtimePublisher>({ publish }),
    logger,
  ).handle(inbound);
  assert.equal(result.duplicate, false);
  assert.equal(h.messages.save.mock.callCount(), 1);
  assert.equal(h.analytics.enqueue.mock.callCount(), 1);
  assert.equal(publish.mock.callCount(), 3);
});
for (const stage of [
  'provider',
  'conversation',
  'save',
  'touch',
  'projection',
  'outbox',
] as const) {
  await test(`inbound ${stage} error propagates before realtime publication`, async () => {
    const h = serviceHarness();
    const cause = new Error(`${stage} failed`);
    const port =
      stage === 'provider'
        ? h.messages.findByProviderMessageIdAnyTenant
        : stage === 'conversation'
          ? h.conversations.findByIdAnyTenant
          : stage === 'save'
            ? h.messages.save
            : stage === 'touch'
              ? h.conversations.touch
              : stage === 'projection'
                ? h.conversations.save
                : h.analytics.enqueue;
    port.mock.mockImplementationOnce(async () => {
      throw cause;
    });
    const publish = mock.fn<RealtimePublisher['publish']>(async () => {});
    await assert.rejects(
      new InboundMessageService(
        h.unitOfWork,
        dependency<RealtimePublisher>({ publish }),
        logger,
      ).handle(inbound),
      cause,
    );
    assert.equal(publish.mock.callCount(), 0);
  });
}
// @covers MessageDispatcher.dispatch
await test('dispatcher forwards tenant to all reads and delivery update, then emits the persisted outcome', async () => {
  const h = serviceHarness();
  const send = mock.fn<ChannelAdapter['send']>(async () => ({
    deliveryStatus: DeliveryStatus.SENT,
    providerMessageId: 'provider-1',
  }));
  const publish = mock.fn<RealtimePublisher['publish']>(async () => {});
  const adapter: ChannelAdapter = { channelType: ChannelType.IN_APP, send };
  const policy: DeliveryPolicy = {
    determineChannels: () => [ChannelType.IN_APP],
  };
  const result = await new MessageDispatcher(
    h.unitOfWork,
    [adapter],
    policy,
    dependency<RealtimePublisher>({ publish }),
    logger,
  ).dispatch(message.id, TENANT);
  assert.deepEqual(h.messages.findById.mock.calls[0]?.arguments, [
    TENANT,
    message.id,
  ]);
  assert.deepEqual(h.conversations.findById.mock.calls[0]?.arguments, [
    TENANT,
    conversation.id,
  ]);
  assert.deepEqual(send.mock.calls[0]?.arguments, [message, conversation]);
  assert.deepEqual(h.messages.updateDeliveryStatus.mock.calls[0]?.arguments, [
    TENANT,
    message.id,
    DeliveryStatus.SENT,
    'provider-1',
  ]);
  assert.deepEqual(result.publishedChannels, [
    `conversation:${conversation.id}`,
    `user:${USER}`,
    `user:${PEER}`,
  ]);
  assert.deepEqual(publish.mock.calls[0]?.arguments[1], {
    ...realtimeEvent,
    deliveryStatus: DeliveryStatus.SENT,
  });
});
for (const kind of ['no-adapter', 'no-targets'] as const) {
  await test(`dispatcher ${kind} still fans out the original message without delivery write`, async () => {
    const h = serviceHarness();
    const send = mock.fn<ChannelAdapter['send']>(async () => ({
      deliveryStatus: DeliveryStatus.SENT,
      providerMessageId: null,
    }));
    const publish = mock.fn<RealtimePublisher['publish']>(async () => {});
    const result = await new MessageDispatcher(
      h.unitOfWork,
      kind === 'no-adapter' ? [] : [{ channelType: ChannelType.IN_APP, send }],
      {
        determineChannels: () =>
          kind === 'no-targets' ? [] : [ChannelType.IN_APP],
      },
      dependency<RealtimePublisher>({ publish }),
      logger,
    ).dispatch(message.id, TENANT);
    assert.equal(result.message, message);
    assert.equal(send.mock.callCount(), 0);
    assert.equal(h.messages.updateDeliveryStatus.mock.callCount(), 0);
    assert.equal(publish.mock.callCount(), 3);
  });
}
for (const missing of ['message', 'conversation'] as const) {
  await test(`dispatcher missing ${missing} stops adapters and realtime`, async () => {
    const h = serviceHarness();
    if (missing === 'message') {
      h.messages.findById.mock.mockImplementationOnce(async () => null);
    } else {
      h.conversations.findById.mock.mockImplementationOnce(async () => null);
    }
    const publish = mock.fn<RealtimePublisher['publish']>(async () => {});
    await assert.rejects(
      new MessageDispatcher(
        h.unitOfWork,
        [],
        { determineChannels: () => [] },
        dependency<RealtimePublisher>({ publish }),
        logger,
      ).dispatch(message.id, TENANT),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(publish.mock.callCount(), 0);
  });
}
await test('dispatcher lost delivery update attempts FAILED recovery and rejects a second lost race', async () => {
  const h = serviceHarness();
  h.messages.updateDeliveryStatus.mock.mockImplementation(async () => null);
  const publish = mock.fn<RealtimePublisher['publish']>(async () => {});
  await assert.rejects(
    new MessageDispatcher(
      h.unitOfWork,
      [
        {
          channelType: ChannelType.IN_APP,
          send: async () => ({
            deliveryStatus: DeliveryStatus.SENT,
            providerMessageId: null,
          }),
        },
      ],
      { determineChannels: () => [ChannelType.IN_APP] },
      dependency<RealtimePublisher>({ publish }),
      logger,
    ).dispatch(message.id, TENANT),
    { code: 'MESSAGE_INPUT_INVALID' },
  );
  assert.equal(h.messages.updateDeliveryStatus.mock.callCount(), 2);
  assert.equal(
    h.messages.updateDeliveryStatus.mock.calls[1]?.arguments[2],
    DeliveryStatus.FAILED,
  );
  assert.equal(publish.mock.callCount(), 0);
});
await test('dispatcher realtime failure propagates after delivery state is persisted', async () => {
  const h = serviceHarness();
  const cause = new Error('publish unavailable');
  const publish = mock.fn<RealtimePublisher['publish']>(async () => {
    throw cause;
  });
  await assert.rejects(
    new MessageDispatcher(
      h.unitOfWork,
      [
        {
          channelType: ChannelType.IN_APP,
          send: async () => ({
            deliveryStatus: DeliveryStatus.SENT,
            providerMessageId: null,
          }),
        },
      ],
      { determineChannels: () => [ChannelType.IN_APP] },
      dependency<RealtimePublisher>({ publish }),
      logger,
    ).dispatch(message.id, TENANT),
    cause,
  );
  assert.equal(h.messages.updateDeliveryStatus.mock.callCount(), 1);
  assert.equal(publish.mock.callCount(), 3);
});
