import type { ConversationReadService } from '../../dist/chat/services/conversation-read.service.js';
import type { ConversationWriteService } from '../../dist/chat/services/conversation-write.service.js';
import type { MessageDispatcher } from '../../dist/chat/services/message-dispatcher.service.js';
import type { MessageReadService } from '../../dist/chat/services/message-read.service.js';
import type { MessageWriteService } from '../../dist/chat/services/message-write.service.js';
import type { ReadStateService } from '../../dist/chat/services/read-state.service.js';
import './chat-fixtures.ts';
import {
  dependency,
  logger,
  conversation,
  conversationModel,
  message,
  messageModel,
  TENANT,
  USER,
  PEER,
  NOW,
  ConversationType,
  DeliveryStatus,
} from './chat-fixtures.ts';
import assert from 'node:assert/strict';
import test, { mock, type Mock } from 'node:test';
const { GraphqlChatReadService } =
  await import('../../dist/chat/services/graphql-chat-read.service.js');
const { GraphqlChatWriteService } =
  await import('../../dist/chat/services/graphql-chat-write.service.js');
interface ReadHarness {
  service: InstanceType<typeof GraphqlChatReadService>;
  list: Mock<ConversationReadService['listForUser']>;
  get: Mock<ConversationReadService['getForParticipant']>;
  messages: Mock<MessageReadService['listMessages']>;
}
function readHarness(): ReadHarness {
  const list = mock.fn<ConversationReadService['listForUser']>(async () => [
    conversation,
  ]);
  const get = mock.fn<ConversationReadService['getForParticipant']>(
    async () => conversation,
  );
  const messages = mock.fn<MessageReadService['listMessages']>(async () => [
    message,
  ]);
  return {
    service: new GraphqlChatReadService(
      dependency<ConversationReadService>({
        listForUser: list,
        getForParticipant: get,
      }),
      dependency<MessageReadService>({ listMessages: messages }),
    ),
    list,
    get,
    messages,
  };
}
interface WriteHarness {
  service: InstanceType<typeof GraphqlChatWriteService>;
  direct: Mock<ConversationWriteService['createDirectConversation']>;
  whatsapp: Mock<ConversationWriteService['createWhatsappConversation']>;
  send: Mock<MessageWriteService['send']>;
  dispatch: Mock<MessageDispatcher['dispatch']>;
  read: Mock<ReadStateService['markRead']>;
}
function writeHarness(): WriteHarness {
  const direct = mock.fn<ConversationWriteService['createDirectConversation']>(
    async () => conversation,
  );
  const whatsapp = mock.fn<
    ConversationWriteService['createWhatsappConversation']
  >(async () => conversation);
  const send = mock.fn<MessageWriteService['send']>(async () => ({
    message,
    tenantId: TENANT,
  }));
  const dispatch = mock.fn<MessageDispatcher['dispatch']>(async () => ({
    message: { ...message, deliveryStatus: DeliveryStatus.SENT },
    publishedChannels: [],
  }));
  const read = mock.fn<ReadStateService['markRead']>(async () => ({
    readState: {
      id: 'read-state-1',
      tenantId: TENANT,
      conversationId: conversation.id,
      userId: USER,
      lastReadAt: NOW,
      lastReadMessageId: null,
    },
    unreadCount: 0,
  }));
  const service = new GraphqlChatWriteService(
    dependency<ConversationWriteService>({
      createDirectConversation: direct,
      createWhatsappConversation: whatsapp,
    }),
    dependency<MessageWriteService>({ send }),
    dependency<MessageDispatcher>({ dispatch }),
    dependency<ReadStateService>({ markRead: read }),
    logger,
  );
  return { service, direct, whatsapp, send, dispatch, read };
}
// @covers GraphqlChatReadService.conversations
await test('GraphQL read list forwards canonical scope and projects every row', async () => {
  const h = readHarness();
  assert.deepEqual(await h.service.conversations(TENANT, USER), [
    conversationModel,
  ]);
  assert.deepEqual(h.list.mock.calls[0]?.arguments, [TENANT, USER]);
  h.list.mock.mockImplementationOnce(async () => []);
  assert.deepEqual(await h.service.conversations(TENANT, USER), []);
});
// @covers GraphqlChatReadService.conversation
await test('GraphQL conversation trims the UUID and maps the authorized row', async () => {
  const h = readHarness();
  assert.deepEqual(
    await h.service.conversation(TENANT, USER, ` ${conversation.id} `),
    conversationModel,
  );
  assert.deepEqual(h.get.mock.calls[0]?.arguments, [
    TENANT,
    USER,
    conversation.id,
  ]);
});
// @covers GraphqlChatReadService.messages
await test('GraphQL message adapter forwards validated pagination/date/id and projects rows', async () => {
  const h = readHarness();
  assert.deepEqual(
    await h.service.messages(
      TENANT,
      USER,
      conversation.id,
      200,
      NOW,
      message.id,
    ),
    [messageModel],
  );
  assert.deepEqual(h.messages.mock.calls[0]?.arguments, [
    TENANT,
    USER,
    conversation.id,
    { limit: 200, before: NOW, beforeId: message.id },
  ]);
  await h.service.messages(TENANT, USER, conversation.id);
  assert.deepEqual(h.messages.mock.calls[1]?.arguments[3], {
    limit: null,
    before: null,
    beforeId: null,
  });
});
for (const args of [
  [conversation.id, '10', NOW, message.id],
  [conversation.id, 1.5, NOW, message.id],
  [conversation.id, 10, new Date('invalid'), message.id],
  [conversation.id, 10, NOW.toISOString(), message.id],
  [conversation.id, 10, NOW, 'invalid'],
  ['invalid', 10, NOW, message.id],
] as const) {
  await test(`GraphQL message adapter rejects invalid scalars ${JSON.stringify(args)}`, async () => {
    const h = readHarness();
    await assert.rejects(
      h.service.messages(TENANT, USER, args[0], args[1], args[2], args[3]),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.messages.mock.callCount(), 0);
  });
}
for (const operation of [
  'conversations',
  'conversation',
  'messages',
] as const) {
  await test(`GraphQL ${operation} service failure remains unchanged`, async () => {
    const h = readHarness();
    const cause = new Error('read unavailable');
    const port =
      operation === 'conversations'
        ? h.list
        : operation === 'conversation'
          ? h.get
          : h.messages;
    port.mock.mockImplementationOnce(async () => {
      throw cause;
    });
    const result =
      operation === 'conversations'
        ? h.service.conversations(TENANT, USER)
        : operation === 'conversation'
          ? h.service.conversation(TENANT, USER, conversation.id)
          : h.service.messages(TENANT, USER, conversation.id);
    await assert.rejects(result, cause);
  });
}
// @covers GraphqlChatWriteService.createInAppConversation
await test('GraphQL direct creation trims participant UUID and supplies default conversation type', async () => {
  const h = writeHarness();
  assert.deepEqual(
    await h.service.createInAppConversation(TENANT, USER, ` ${PEER} `),
    conversationModel,
  );
  assert.deepEqual(h.direct.mock.calls[0]?.arguments, [
    TENANT,
    USER,
    PEER,
    ConversationType.DIRECT,
  ]);
  await h.service.createInAppConversation(
    TENANT,
    USER,
    PEER,
    ConversationType.SUPPORT,
  );
  assert.equal(h.direct.mock.calls[1]?.arguments[3], ConversationType.SUPPORT);
});
for (const [participant, type] of [
  ['invalid', undefined],
  [PEER, 'invalid'],
]) {
  await test('GraphQL direct creation rejects invalid participant or enum before service', async () => {
    const h = writeHarness();
    await assert.rejects(
      h.service.createInAppConversation(TENANT, USER, participant, type),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.direct.mock.callCount(), 0);
  });
}
// @covers GraphqlChatWriteService.createWhatsappConversation
await test('GraphQL WhatsApp creation forwards normalized phone/display and maps the result', async () => {
  const h = writeHarness();
  assert.deepEqual(
    await h.service.createWhatsappConversation(
      TENANT,
      USER,
      ' +49301234567 ',
      '  Ada  ',
    ),
    conversationModel,
  );
  assert.deepEqual(h.whatsapp.mock.calls[0]?.arguments, [
    TENANT,
    USER,
    '+49301234567',
    'Ada',
  ]);
  await h.service.createWhatsappConversation(TENANT, USER, '+49301234567');
  assert.equal(h.whatsapp.mock.calls[1]?.arguments[3], null);
});
for (const [phone, display] of [
  ['invalid', 'Ada'],
  ['+49301234567', 1],
  ['+49301234567', 'x'.repeat(256)],
]) {
  await test('GraphQL WhatsApp creation rejects invalid phone or oversized/non-string name', async () => {
    const h = writeHarness();
    await assert.rejects(
      h.service.createWhatsappConversation(TENANT, USER, phone, display),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.whatsapp.mock.callCount(), 0);
  });
}
// @covers GraphqlChatWriteService.sendMessage
await test('GraphQL sending stores first then dispatches in the same tenant and returns the delivered projection', async () => {
  const h = writeHarness();
  assert.deepEqual(
    await h.service.sendMessage(
      TENANT,
      USER,
      conversation.id,
      '  Hello  ',
      'IMAGE',
      'correlation-1',
    ),
    { ...messageModel, deliveryStatus: DeliveryStatus.SENT },
  );
  assert.deepEqual(h.send.mock.calls[0]?.arguments, [
    {
      tenantId: TENANT,
      senderId: USER,
      conversationId: conversation.id,
      body: '  Hello  ',
      contentType: 'IMAGE',
      correlationId: 'correlation-1',
    },
  ]);
  assert.deepEqual(h.dispatch.mock.calls[0]?.arguments, [message.id, TENANT]);
});
await test('GraphQL sending cannot dispatch until persistence resolves', async () => {
  const h = writeHarness();
  const committed = Promise.withResolvers<{
    message: typeof message;
    tenantId: string;
  }>();
  h.send.mock.mockImplementationOnce(async () => committed.promise);
  const result = h.service.sendMessage(TENANT, USER, conversation.id, 'Hello');
  assert.equal(h.dispatch.mock.callCount(), 0);
  committed.resolve({ message, tenantId: TENANT });
  await result;
  assert.equal(h.dispatch.mock.callCount(), 1);
});
for (const cause of [new Error('dispatch failed'), 'dispatch failed']) {
  await test('post-commit dispatch failure returns the stored pending message', async () => {
    const h = writeHarness();
    h.dispatch.mock.mockImplementationOnce(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- simulate both catch branches
      throw cause;
    });
    assert.deepEqual(
      await h.service.sendMessage(TENANT, USER, conversation.id, 'Hello'),
      messageModel,
    );
  });
}
for (const body of ['', '   ', 1, 'x'.repeat(64001)]) {
  await test(`GraphQL send rejects invalid body of length ${typeof body === 'string' ? body.length : 'non-string'} before persistence`, async () => {
    const h = writeHarness();
    await assert.rejects(
      h.service.sendMessage(TENANT, USER, conversation.id, body),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.send.mock.callCount(), 0);
    assert.equal(h.dispatch.mock.callCount(), 0);
  });
}
await test('GraphQL send accepts the maximum 64000-character body', async () => {
  const h = writeHarness();
  await h.service.sendMessage(TENANT, USER, conversation.id, 'x'.repeat(64000));
  assert.equal(h.send.mock.callCount(), 1);
});
// @covers GraphqlChatWriteService.markRead
await test('GraphQL markRead defaults to controlled current time and maps unread result to true', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const h = writeHarness();
  assert.equal(await h.service.markRead(TENANT, USER, conversation.id), true);
  assert.deepEqual(h.read.mock.calls[0]?.arguments, [
    TENANT,
    conversation.id,
    USER,
    NOW,
    null,
  ]);
});
await test('GraphQL markRead preserves explicit date and message UUID', async () => {
  const h = writeHarness();
  assert.equal(
    await h.service.markRead(
      TENANT,
      USER,
      conversation.id,
      NOW,
      ` ${message.id} `,
    ),
    true,
  );
  assert.deepEqual(h.read.mock.calls[0]?.arguments, [
    TENANT,
    conversation.id,
    USER,
    NOW,
    message.id,
  ]);
});
for (const [at, id] of [
  [new Date('invalid'), null],
  [NOW, 'invalid'],
]) {
  await test('GraphQL markRead rejects invalid cursor before write service', async () => {
    const h = writeHarness();
    await assert.rejects(
      h.service.markRead(TENANT, USER, conversation.id, at, id),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.read.mock.callCount(), 0);
  });
}
for (const operation of ['direct', 'whatsapp', 'send', 'read'] as const) {
  await test(`GraphQL ${operation} application failure remains observable`, async () => {
    const h = writeHarness();
    const cause = new Error('write unavailable');
    h[operation].mock.mockImplementationOnce(async () => {
      throw cause;
    });
    const result =
      operation === 'direct'
        ? h.service.createInAppConversation(TENANT, USER, PEER)
        : operation === 'whatsapp'
          ? h.service.createWhatsappConversation(TENANT, USER, '+49301234567')
          : operation === 'send'
            ? h.service.sendMessage(TENANT, USER, conversation.id, 'Hello')
            : h.service.markRead(TENANT, USER, conversation.id, NOW);
    await assert.rejects(result, cause);
    if (operation === 'send') {
      assert.equal(h.dispatch.mock.callCount(), 0);
    }
  });
}
