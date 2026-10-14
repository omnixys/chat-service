import {
  createInMemoryRepositories,
  makeLogger,
  makeRealtimePublisher,
} from '../support/in-memory.mjs';
import { strict as assert } from 'node:assert';
import test from 'node:test';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const logger = makeLogger();

async function load() {
  const repositories = createInMemoryRepositories();
  const [
    { ConversationWriteService },
    { ConversationReadService },
    { MessageWriteService },
    { InboundMessageService },
    { InternalChatController },
    { defaultDeliveryPolicy },
    { canTransitionDeliveryStatus, DeliveryStatus },
    { CHANNEL_DELIVERY_ADAPTERS },
  ] = await Promise.all([
    import('../../dist/chat/services/conversation-write.service.js'),
    import('../../dist/chat/services/conversation-read.service.js'),
    import('../../dist/chat/services/message-write.service.js'),
    import('../../dist/chat/services/inbound-message.service.js'),
    import('../../dist/chat/controllers/internal.controller.js'),
    import('../../dist/chat/ports/delivery-policy.token.js'),
    import('../../dist/chat/models/enums/message.enums.js'),
    import('../../dist/chat/ports/channel-adapters.token.js'),
  ]);
  return {
    repositories,
    write: new ConversationWriteService(repositories.unitOfWork, logger),
    reads: new ConversationReadService(repositories.unitOfWork),
    messages: new MessageWriteService(repositories.unitOfWork, logger),
    inbound: new InboundMessageService(
      repositories.unitOfWork,
      makeRealtimePublisher(),
      logger,
    ),
    deliveryPolicy: defaultDeliveryPolicy,
    DeliveryStatus,
    canTransitionDeliveryStatus,
    controller: new InternalChatController(
      new ConversationReadService(repositories.unitOfWork),
      new InboundMessageService(
        repositories.unitOfWork,
        makeRealtimePublisher(),
        logger,
      ),
      new MessageWriteService(repositories.unitOfWork, logger),
    ),
    tokens: { CHANNEL_DELIVERY_ADAPTERS },
  };
}

test('verifyParticipant answers 204, 403 and 404 for the gateway', async () => {
  const { write, controller } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  await controller.verifyParticipant(conversation.id, ALICE);

  await assert.rejects(
    () =>
      controller.verifyParticipant(
        conversation.id,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ),
    (error) => error.getStatus() === 403,
    'a non-participant is forbidden',
  );
  await assert.rejects(
    () =>
      controller.verifyParticipant(
        '99999999-9999-4999-8999-999999999999',
        ALICE,
      ),
    (error) => error.getStatus() === 404,
    'an unknown conversation is not found',
  );
});

test('delivery status transitions are monotonic and terminal states are final', async () => {
  const { canTransitionDeliveryStatus, DeliveryStatus } = await load();

  assert.equal(
    canTransitionDeliveryStatus(DeliveryStatus.PENDING, DeliveryStatus.SENT),
    true,
  );
  assert.equal(
    canTransitionDeliveryStatus(DeliveryStatus.SENT, DeliveryStatus.DELIVERED),
    true,
  );
  assert.equal(
    canTransitionDeliveryStatus(DeliveryStatus.DELIVERED, DeliveryStatus.READ),
    true,
  );

  assert.equal(
    canTransitionDeliveryStatus(DeliveryStatus.DELIVERED, DeliveryStatus.SENT),
    false,
  );
  assert.equal(
    canTransitionDeliveryStatus(DeliveryStatus.READ, DeliveryStatus.DELIVERED),
    false,
  );
  assert.equal(
    canTransitionDeliveryStatus(DeliveryStatus.FAILED, DeliveryStatus.SENT),
    false,
  );
  assert.equal(
    canTransitionDeliveryStatus(DeliveryStatus.SENT, DeliveryStatus.PENDING),
    false,
  );
});

test('applyDeliveryStatus refuses to move a delivered message backwards', async () => {
  const { write, messages } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);
  const { message } = await messages.send({
    tenantId: TENANT,
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'ping',
  });

  const delivered = await messages.applyDeliveryStatus({
    messageId: message.id,
    deliveryStatus: 'DELIVERED',
    providerMessageId: 'provider-1',
  });
  assert.equal(delivered.deliveryStatus, 'DELIVERED');

  await assert.rejects(
    () =>
      messages.applyDeliveryStatus({
        messageId: message.id,
        deliveryStatus: 'SENT',
        providerMessageId: 'provider-1',
      }),
    (error) =>
      error.code === 'MESSAGE_INPUT_INVALID' &&
      error.diagnostics.reason === 'invalid-delivery-status-transition' &&
      error.httpStatus === 409,
    'a delivered message must not fall back to sent',
  );
});

test('an inbound provider message is stored once and published', async () => {
  const { write, inbound, repositories } = await load();
  const conversation = await write.createWhatsappConversation(
    TENANT,
    ALICE,
    '+4915112345678',
    'Alice',
  );

  const first = await inbound.handle({
    messageId: 'wamid-1',
    channel: 'WHATSAPP',
    from: '+4915112345678',
    body: 'hello there',
    occurredAt: new Date(),
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.message.conversationId, conversation.id);
  assert.equal(repositories.stores.messages.length, 1);

  const again = await inbound.handle({
    messageId: 'wamid-1',
    channel: 'WHATSAPP',
    from: '+4915112345678',
    body: 'hello there',
    occurredAt: new Date(),
  });
  assert.equal(
    again.duplicate,
    true,
    'the same provider id must not be stored twice',
  );
  assert.equal(repositories.stores.messages.length, 1);
});

test('an inbound message from an unknown address is refused', async () => {
  const { inbound } = await load();

  await assert.rejects(
    () =>
      inbound.handle({
        messageId: 'wamid-unknown',
        channel: 'WHATSAPP',
        from: '+4915199999999',
        body: 'who am i',
        occurredAt: new Date(),
      }),
    (error) =>
      error.code === 'MESSAGE_INPUT_INVALID' &&
      error.diagnostics.reason === 'unmatched-inbound-message' &&
      error.httpStatus === 422,
  );
});

test('an inbound message with an empty body is refused', async () => {
  const { write, inbound } = await load();
  await write.createWhatsappConversation(
    TENANT,
    ALICE,
    '+4915112345678',
    'Alice',
  );

  await assert.rejects(
    () =>
      inbound.handle({
        messageId: 'wamid-empty',
        channel: 'WHATSAPP',
        from: '+4915112345678',
        body: '   ',
        occurredAt: new Date(),
      }),
    (error) => error.code === 'MESSAGE_INPUT_INVALID',
  );
});

test('an ambiguous provider id is refused instead of guessed', async () => {
  const { write, inbound, repositories } = await load();
  const first = await write.createWhatsappConversation(
    TENANT,
    ALICE,
    '+4915112345678',
    'A',
  );
  await write.createWhatsappConversation(
    OTHER_TENANT,
    ALICE,
    '+4915112345678',
    'B',
  );

  await assert.rejects(
    () =>
      inbound.handle({
        messageId: 'wamid-1',
        channel: 'WHATSAPP',
        from: '+4915112345678',
        body: 'ambiguous',
        contentType: 'TEXT',
        conversationId: null,
      }),
    (error) =>
      error.code === 'MESSAGE_INPUT_INVALID' &&
      error.diagnostics.reason === 'inbound-external-address-ambiguous' &&
      error.diagnostics.matchCount === 2,
    'an address owned by two tenants must not be resolved by guessing',
  );
  assert.equal(repositories.stores.messages.length, 0);
  assert.equal(first.channel, 'WHATSAPP');
});

test('the delivery policy targets the channel of the message', async () => {
  const { write, messages, deliveryPolicy } = await load();
  const conversation = await write.createWhatsappConversation(
    TENANT,
    ALICE,
    '+4915112345678',
    'Alice',
  );
  const { message } = await messages.send({
    tenantId: TENANT,
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'ping',
  });

  const targets = deliveryPolicy.determineChannels(message, {
    id: conversation.id,
    channel: 'WHATSAPP',
    participantIds: [ALICE],
    externalAddress: '+4915112345678',
  });

  assert.deepEqual(
    [...targets],
    ['WHATSAPP'],
    'only the conversation channel is targeted',
  );

  const { message: systemMessage } = await messages.send({
    tenantId: TENANT,
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'notice',
    contentType: 'SYSTEM',
  });
  assert.deepEqual(
    [...deliveryPolicy.determineChannels(systemMessage, conversation)],
    ['IN_APP'],
    'a system notice must never leave the platform',
  );
});

test('the realtime publisher fans out to the conversation and user channels', async () => {
  const { write, messages } = await load();
  const conversation = await write.createWhatsappConversation(
    TENANT,
    ALICE,
    '+4915112345678',
    'Alice',
  );
  const { message } = await messages.send({
    tenantId: TENANT,
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'ping',
  });

  const { eventChannels, transportChannel } =
    await import('../../dist/adapter/realtime/realtime.events.js');

  const channels = eventChannels(conversation.id, [ALICE]);
  assert.deepEqual(
    [...channels],
    [`conversation:${conversation.id}`, `user:${ALICE}`],
  );
  assert.deepEqual(
    channels.map(transportChannel),
    [`chat:conversation:${conversation.id}`, `chat:user:${ALICE}`],
    'the gateway subscribes to the prefixed transport channels',
  );
  assert.deepEqual(
    [...eventChannels(conversation.id, [])],
    [`conversation:${conversation.id}`],
    'a message without resolved participants still reaches the conversation channel',
  );

  const realtime = makeRealtimePublisher();
  await Promise.all(
    channels.map((channel) =>
      realtime.publish(channel, { messageId: message.id }),
    ),
  );
  assert.deepEqual(
    realtime.published.map((entry) => entry.channel),
    [...channels],
    'one event is published per physical channel',
  );
});
