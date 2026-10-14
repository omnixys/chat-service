import './chat-fixtures.ts';
import {
  conversation,
  message,
  TENANT,
  USER,
  NOW,
  logger,
  DeliveryStatus,
} from './chat-fixtures.ts';
import { serviceHarness } from './service-fixtures.ts';
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
const crypto = await import('node:crypto');
mock.module('node:crypto', {
  namedExports: { ...crypto, randomUUID: () => message.id },
  defaultExport: { ...crypto.default, randomUUID: () => message.id },
});
const { MessageWriteService } =
  await import('../../dist/chat/services/message-write.service.js');
const command = {
  tenantId: TENANT,
  senderId: USER,
  conversationId: conversation.id,
  body: '  Hello  ',
  correlationId: 'correlation-1',
};
// @covers MessageWriteService.send
await test('sending uses fixed identity/time and stores a pending message plus the exact analytics fact', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const h = serviceHarness();
  const result = await new MessageWriteService(h.unitOfWork, logger).send(
    command,
  );
  assert.deepEqual(result, {
    message: { ...message, body: command.body },
    tenantId: TENANT,
  });
  assert.deepEqual(h.messages.save.mock.calls[0]?.arguments, [
    TENANT,
    result.message,
  ]);
  assert.deepEqual(h.conversations.touch.mock.calls[0]?.arguments, [
    TENANT,
    conversation.id,
    NOW,
  ]);
  assert.deepEqual(h.conversations.save.mock.calls[0]?.arguments, [
    TENANT,
    {
      ...conversation,
      lastMessage: command.body,
      lastMessageAt: NOW,
      updatedAt: NOW,
    },
  ]);
  assert.deepEqual(h.analytics.enqueue.mock.calls[0]?.arguments, [
    {
      topic: 'chat.message.sent.v1',
      eventName: 'message.sent',
      aggregateId: message.id,
      aggregateType: 'chat.message',
      subjectId: USER,
      tenantId: TENANT,
      correlationId: 'correlation-1',
      actorId: USER,
      properties: {
        conversationId: conversation.id,
        channel: message.channel,
        contentType: 'TEXT',
        bodyLength: command.body.length,
      },
    },
  ]);
  assert.equal(h.transaction.mock.callCount(), 1);
});
for (const contentType of [null, 'TEXT', 'IMAGE', 'FILE', 'SYSTEM']) {
  await test(`message sending supports declared content type ${String(contentType)}`, async () => {
    const h = serviceHarness();
    const result = await new MessageWriteService(h.unitOfWork, logger).send({
      ...command,
      contentType,
    });
    assert.equal(result.message.contentType, contentType ?? 'TEXT');
  });
}
await test('invalid content type fails before membership or persistence', async () => {
  const h = serviceHarness();
  await assert.rejects(
    new MessageWriteService(h.unitOfWork, logger).send({
      ...command,
      contentType: 'unsupported',
    }),
    { code: 'MESSAGE_INPUT_INVALID' },
  );
  assert.equal(h.transaction.mock.callCount(), 0);
});
await test('successful membership followed by a missing conversation fails before storing', async () => {
  const h = serviceHarness();
  h.conversations.findById.mock.mockImplementationOnce(async () => null);
  await assert.rejects(
    new MessageWriteService(h.unitOfWork, logger).send(command),
    { code: 'CONVERSATION_NOT_FOUND' },
  );
  assert.equal(h.messages.save.mock.callCount(), 0);
});
for (const stage of [
  'membership',
  'conversation',
  'save',
  'touch',
  'projection',
  'outbox',
] as const) {
  await test(`message ${stage} failure aborts later actions`, async () => {
    const h = serviceHarness();
    const cause = new Error(`${stage} failed`);
    const port =
      stage === 'membership'
        ? h.conversations.isParticipant
        : stage === 'conversation'
          ? h.conversations.findById
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
    await assert.rejects(
      new MessageWriteService(h.unitOfWork, logger).send(command),
      cause,
    );
    if (stage !== 'outbox') {
      assert.equal(h.analytics.enqueue.mock.callCount(), 0);
    }
  });
}
// @covers MessageWriteService.applyDeliveryStatus
await test('provider-only delivery update derives tenant from the resolved row and writes the exact outbox transition', async () => {
  const h = serviceHarness();
  h.messages.findByProviderMessageIdAnyTenant.mock.mockImplementationOnce(
    async () => [message],
  );
  const updated = await new MessageWriteService(
    h.unitOfWork,
    logger,
  ).applyDeliveryStatus({
    providerMessageId: 'provider-1',
    deliveryStatus: DeliveryStatus.SENT,
    correlationId: 'correlation-1',
  });
  assert.deepEqual(h.messages.updateDeliveryStatus.mock.calls[0]?.arguments, [
    TENANT,
    message.id,
    DeliveryStatus.SENT,
    'provider-1',
  ]);
  assert.equal(h.messages.findByIdAnyTenant.mock.callCount(), 0);
  assert.deepEqual(h.analytics.enqueue.mock.calls[0]?.arguments, [
    {
      topic: 'chat.message.delivery-status-changed.v1',
      eventName: 'message.delivery-status-changed',
      aggregateId: updated.id,
      aggregateType: 'chat.message',
      subjectId: USER,
      tenantId: TENANT,
      correlationId: 'correlation-1',
      actorId: USER,
      properties: {
        conversationId: conversation.id,
        channel: message.channel,
        from: DeliveryStatus.PENDING,
        to: DeliveryStatus.SENT,
      },
    },
  ]);
});
await test('internal message ID takes precedence when both references are present', async () => {
  const h = serviceHarness();
  await new MessageWriteService(h.unitOfWork, logger).applyDeliveryStatus({
    messageId: message.id,
    providerMessageId: 'provider-1',
    deliveryStatus: DeliveryStatus.SENT,
  });
  assert.equal(h.messages.findByProviderMessageIdAnyTenant.mock.callCount(), 0);
  assert.deepEqual(h.messages.findByIdAnyTenant.mock.calls[0]?.arguments, [
    message.id,
  ]);
});
for (const options of [
  { deliveryStatus: 'invalid', messageId: message.id },
  { deliveryStatus: DeliveryStatus.SENT },
]) {
  await test('invalid status or absent references cannot start a delivery transaction', async () => {
    const h = serviceHarness();
    await assert.rejects(
      new MessageWriteService(h.unitOfWork, logger).applyDeliveryStatus(
        options,
      ),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.transaction.mock.callCount(), 0);
  });
}
for (const reference of [
  'internal',
  'provider',
  'ambiguous-provider',
] as const) {
  await test(`${reference} delivery reference cannot resolve an absent or ambiguous row`, async () => {
    const h = serviceHarness();
    h.messages.findByIdAnyTenant.mock.mockImplementationOnce(async () => null);
    if (reference === 'ambiguous-provider') {
      h.messages.findByProviderMessageIdAnyTenant.mock.mockImplementationOnce(
        async () => [
          message,
          { ...message, tenantId: 'other-tenant', id: 'other-message' },
        ],
      );
    }
    await assert.rejects(
      new MessageWriteService(h.unitOfWork, logger).applyDeliveryStatus({
        messageId: reference === 'internal' ? message.id : undefined,
        providerMessageId: reference === 'internal' ? undefined : 'provider-1',
        deliveryStatus: DeliveryStatus.SENT,
      }),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.messages.updateDeliveryStatus.mock.callCount(), 0);
    assert.equal(h.analytics.enqueue.mock.callCount(), 0);
  });
}
await test('same delivery status is idempotent and does not mutate provider identity or emit another fact', async () => {
  const h = serviceHarness();
  assert.equal(
    await new MessageWriteService(h.unitOfWork, logger).applyDeliveryStatus({
      messageId: message.id,
      providerMessageId: 'new-provider-id',
      deliveryStatus: DeliveryStatus.PENDING,
    }),
    message,
  );
  assert.equal(h.messages.updateDeliveryStatus.mock.callCount(), 0);
  assert.equal(h.analytics.enqueue.mock.callCount(), 0);
});
await test('delivery update lost race is rejected before outbox enqueue', async () => {
  const h = serviceHarness();
  h.messages.updateDeliveryStatus.mock.mockImplementationOnce(async () => null);
  await assert.rejects(
    new MessageWriteService(h.unitOfWork, logger).applyDeliveryStatus({
      messageId: message.id,
      deliveryStatus: DeliveryStatus.SENT,
    }),
    { code: 'MESSAGE_INPUT_INVALID' },
  );
  assert.equal(h.analytics.enqueue.mock.callCount(), 0);
});
for (const stage of ['resolve', 'update', 'outbox'] as const) {
  await test(`delivery ${stage} failure remains observable`, async () => {
    const h = serviceHarness();
    const cause = new Error(`${stage} failed`);
    const port =
      stage === 'resolve'
        ? h.messages.findByIdAnyTenant
        : stage === 'update'
          ? h.messages.updateDeliveryStatus
          : h.analytics.enqueue;
    port.mock.mockImplementationOnce(async () => {
      throw cause;
    });
    await assert.rejects(
      new MessageWriteService(h.unitOfWork, logger).applyDeliveryStatus({
        messageId: message.id,
        deliveryStatus: DeliveryStatus.SENT,
      }),
      cause,
    );
  });
}
