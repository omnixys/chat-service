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
const CAROL = 'ccccccccc-cccc-4ccc-8ccc-cccccccccccc';

const logger = makeLogger();

async function load() {
  const repositories = createInMemoryRepositories();
  const [
    { ConversationWriteService },
    { ConversationReadService },
    { MessageWriteService },
    { MessageReadService },
    { ReadStateService },
    { MessageDispatcher },
    { ConversationType },
  ] = await Promise.all([
    import('../../dist/chat/services/conversation-write.service.js'),
    import('../../dist/chat/services/conversation-read.service.js'),
    import('../../dist/chat/services/message-write.service.js'),
    import('../../dist/chat/services/message-read.service.js'),
    import('../../dist/chat/services/read-state.service.js'),
    import('../../dist/chat/services/message-dispatcher.service.js'),
    import('../../dist/chat/models/enums/conversation.enums.js'),
  ]);
  return {
    repositories,
    write: new ConversationWriteService(repositories.unitOfWork, logger),
    reads: new ConversationReadService(repositories.unitOfWork),
    messages: new MessageWriteService(repositories.unitOfWork, logger),
    messageReads: new MessageReadService(repositories.unitOfWork, logger),
    readStates: new ReadStateService(repositories.unitOfWork, logger),
    ConversationType,
    realtime: makeRealtimePublisher(),
    dispatcherFactory: (adapters, policy) =>
      new MessageDispatcher(
        repositories.unitOfWork,
        adapters,
        policy,
        makeRealtimePublisher(),
        logger,
      ),
  };
}

test('a direct conversation is created once and reused for the mirrored pair', async () => {
  const { write, reads } = await load();

  const first = await write.createDirectConversation(TENANT, ALICE, BOB);
  const second = await write.createDirectConversation(TENANT, BOB, ALICE);

  assert.equal(
    first.id,
    second.id,
    'mirrored participant pair must resolve to one row',
  );
  assert.equal(first.channel, 'IN_APP');
  assert.deepEqual([...first.participantIds].sort(), [ALICE, BOB].sort());

  const mine = await reads.listForUser(TENANT, ALICE);
  assert.equal(mine.length, 1);
});

test('participant pairs are isolated per tenant', async () => {
  const { write, reads, repositories } = await load();

  const tenantA = await write.createDirectConversation(TENANT, ALICE, BOB);
  const tenantB = await write.createDirectConversation(
    OTHER_TENANT,
    ALICE,
    BOB,
  );

  assert.notEqual(
    tenantA.id,
    tenantB.id,
    'same pair in two tenants must be two rows',
  );
  assert.equal(repositories.stores.conversations.length, 2);

  const foreign = await reads.listForUser(OTHER_TENANT, CAROL);
  assert.deepEqual(foreign, [], 'a user of another tenant sees nothing');
});

test('membership is evaluated before existence, unknown ids are not found', async () => {
  const { write, reads } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  await assert.rejects(
    () => reads.getForParticipant(TENANT, CAROL, conversation.id),
    (error) => error.code === 'CONVERSATION_NOT_FOUND',
    'a non-participant must not learn that the conversation exists',
  );
  await assert.rejects(
    () =>
      reads.getForParticipant(
        TENANT,
        ALICE,
        '99999999-9999-4999-8999-999999999999',
      ),
    (error) => error.code === 'CONVERSATION_NOT_FOUND',
  );
});

test('a conversation of another tenant is invisible', async () => {
  const { write, reads } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  await assert.rejects(
    () => reads.getForParticipant(OTHER_TENANT, ALICE, conversation.id),
    (error) => error.code === 'CONVERSATION_NOT_FOUND',
  );
});

test('a whatsapp address cannot be taken over by a second user', async () => {
  const { write } = await load();

  const owner = await write.createWhatsappConversation(
    TENANT,
    ALICE,
    '+4915112345678',
    'Alice',
  );
  const reused = await write.createWhatsappConversation(
    TENANT,
    ALICE,
    '+49 151 1234 5678',
    null,
  );

  assert.equal(
    reused.id,
    owner.id,
    'the same number normalises to the same address',
  );
  await assert.rejects(
    () =>
      write.createWhatsappConversation(TENANT, BOB, '+4915112345678', 'Bob'),
    (error) => error.code === 'MESSAGE_INPUT_INVALID',
    'the address already belongs to another user',
  );
});

test('sendMessage stores the message, updates the conversation and enqueues the fact', async () => {
  const { write, messages, repositories } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  const { message } = await messages.send({
    tenantId: TENANT,
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'hello',
    contentType: 'TEXT',
  });

  assert.equal(message.deliveryStatus, 'PENDING');
  assert.equal(message.channel, 'IN_APP');
  assert.equal(repositories.stores.messages.length, 1);
  assert.equal(repositories.stores.messages[0].tenantId, TENANT);
  assert.equal(
    repositories.stores.conversations.find((row) => row.id === conversation.id)
      .lastMessage,
    'hello',
  );
  assert.ok(
    repositories.stores.facts.some(
      (fact) => fact.topic === 'chat.message.sent.v1',
    ),
    'the analytics fact must be enqueued in the same transaction',
  );
});

test('sendMessage refuses a conversation the sender does not participate in', async () => {
  const { write, messages } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  await assert.rejects(
    () =>
      messages.send({
        tenantId: TENANT,
        conversationId: conversation.id,
        senderId: CAROL,
        body: 'intruding',
      }),
    (error) => error.code === 'CONVERSATION_NOT_FOUND',
    'a non-participant must not learn that the conversation exists',
  );
});

test('sendMessage refuses a conversation of another tenant', async () => {
  const { write, messages } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  await assert.rejects(
    () =>
      messages.send({
        tenantId: OTHER_TENANT,
        conversationId: conversation.id,
        senderId: ALICE,
        body: 'cross tenant',
      }),
    (error) =>
      error.code === 'CONVERSATION_NOT_FOUND' ||
      error.code === 'CONVERSATION_ACCESS_DENIED',
  );
});

test('an empty body is rejected before anything is stored', async () => {
  const { write, messages, repositories } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  await assert.rejects(
    () =>
      messages.send({
        tenantId: TENANT,
        conversationId: conversation.id,
        senderId: ALICE,
        body: '   ',
      }),
    (error) => error.code === 'MESSAGE_INPUT_INVALID',
  );
  assert.equal(repositories.stores.messages.length, 0);
});

test('dispatch marks the message delivered and publishes on both channels', async () => {
  const { write, messages, dispatcherFactory, repositories } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);
  const { message } = await messages.send({
    tenantId: TENANT,
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'ping',
  });

  const sent = [];
  const adapter = {
    channelType: 'IN_APP',
    async send(sentMessage) {
      sent.push(sentMessage.id);
      return { deliveryStatus: 'DELIVERED', providerMessageId: 'inapp-1' };
    },
  };
  const policy = { determineChannels: () => ['inapp'] };

  const result = await dispatcherFactory([adapter], policy).dispatch(
    message.id,
    TENANT,
  );

  assert.equal(result.message.deliveryStatus, 'DELIVERED');
  assert.equal(repositories.stores.messages[0].providerMessageId, 'inapp-1');
  assert.deepEqual(sent, [message.id]);
  assert.ok(
    result.publishedChannels.includes(`conversation:${conversation.id}`),
    'the conversation channel must be published',
  );
});

test('a failing adapter records FAILED instead of leaving the message pending', async () => {
  const { write, messages, dispatcherFactory, repositories } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);
  const { message } = await messages.send({
    tenantId: TENANT,
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'ping',
  });

  const adapter = {
    channelType: 'IN_APP',
    async send() {
      throw new Error('gateway down');
    },
  };
  const policy = { determineChannels: () => ['inapp'] };

  const result = await dispatcherFactory([adapter], policy).dispatch(
    message.id,
    TENANT,
  );

  assert.equal(result.message.deliveryStatus, 'FAILED');
  assert.equal(repositories.stores.messages[0].deliveryStatus, 'FAILED');
});

test('dispatch refuses a message of another tenant', async () => {
  const { write, messages, dispatcherFactory } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);
  const { message } = await messages.send({
    tenantId: TENANT,
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'ping',
  });
  const adapter = {
    channelType: 'IN_APP',
    async send() {
      throw new Error('must not be called');
    },
  };
  const policy = { determineChannels: () => ['inapp'] };

  await assert.rejects(
    () =>
      dispatcherFactory([adapter], policy).dispatch(message.id, OTHER_TENANT),
    (error) => error.code === 'MESSAGE_INPUT_INVALID',
  );
});

test('markRead counts only foreign messages and never moves the cursor backwards', async () => {
  const { write, messages, readStates, repositories } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  for (const body of ['one', 'two']) {
    await messages.send({
      tenantId: TENANT,
      conversationId: conversation.id,
      senderId: BOB,
      body,
    });
  }
  await messages.send({
    tenantId: TENANT,
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'own message',
  });

  const marked = await readStates.markRead(
    TENANT,
    conversation.id,
    ALICE,
    new Date(Date.now() + 60_000),
    null,
  );
  assert.equal(marked.unreadCount, 0, 'everything is read after marking');

  const cursor = repositories.stores.readStates.find(
    (row) => row.userId === ALICE,
  );
  assert.ok(cursor.lastReadAt instanceof Date || cursor.lastReadAt !== null);

  const back = await readStates.markRead(
    TENANT,
    conversation.id,
    ALICE,
    new Date('2000-01-01T00:00:00.000Z'),
    null,
  );
  assert.equal(
    back.unreadCount,
    0,
    'a stale cursor must not resurrect the unread state',
  );
  const unchanged = repositories.stores.readStates.find(
    (row) => row.userId === ALICE,
  );
  assert.equal(
    new Date(unchanged.lastReadAt).getTime(),
    new Date(cursor.lastReadAt).getTime(),
    'the stored cursor must not move backwards',
  );
});

test('a page holds the newest window, oldest first, and the cursor walks backwards', async () => {
  const { write, messages, messageReads, repositories } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  for (const body of ['m1', 'm2', 'm3', 'm4']) {
    await messages.send({
      tenantId: TENANT,
      conversationId: conversation.id,
      senderId: BOB,
      body,
    });
  }

  // Messages written in the same millisecond share a timestamp, so the keyset is
  // (createdAt, id). The adapter reads the newest window and reverses it, which is
  // what the Python service produced: the page itself is oldest first.
  const ascending = repositories.stores.messages
    .filter((row) => row.conversationId === conversation.id)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((row) => row.id);

  const first = await messageReads.listMessages(
    TENANT,
    ALICE,
    conversation.id,
    {
      limit: 2,
    },
  );
  assert.deepEqual(
    first.map((message) => message.id),
    ascending.slice(-2),
    'the first page holds the newest window, returned oldest first',
  );

  // `before` means "older than this row", so the continuation cursor is the oldest
  // message of the page, which is its first element because the page is ascending.
  const oldest = first[0];
  const second = await messageReads.listMessages(
    TENANT,
    ALICE,
    conversation.id,
    {
      limit: 2,
      before: oldest.createdAt,
      beforeId: oldest.id,
    },
  );
  assert.deepEqual(
    second.map((message) => message.id),
    ascending.slice(0, 2),
    'the cursor continues the keyset order without overlap or gaps',
  );

  const overlap = second.filter((message) =>
    first.some((seen) => seen.id === message.id),
  );
  assert.deepEqual(overlap, [], 'pages must not repeat a message');
});

test('the page limit is clamped to the documented range', async () => {
  const { write, messages, messageReads } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);
  for (let index = 0; index < 5; index += 1) {
    await messages.send({
      tenantId: TENANT,
      conversationId: conversation.id,
      senderId: BOB,
      body: `m${index}`,
    });
  }

  await assert.rejects(
    () =>
      messageReads.listMessages(TENANT, ALICE, conversation.id, {
        limit: 0,
      }),
    (error) => error.code === 'MESSAGE_INPUT_INVALID',
  );
  const clampedHigh = await messageReads.listMessages(
    TENANT,
    ALICE,
    conversation.id,
    { limit: 5000 },
  );

  assert.equal(clampedHigh.length, 5);
});

test('listMessages refuses a conversation of another tenant', async () => {
  const { write, messageReads } = await load();
  const conversation = await write.createDirectConversation(TENANT, ALICE, BOB);

  await assert.rejects(
    () =>
      messageReads.listMessages(OTHER_TENANT, ALICE, conversation.id, {
        limit: 10,
      }),
    (error) =>
      error.code === 'CONVERSATION_NOT_FOUND' ||
      error.code === 'CONVERSATION_ACCESS_DENIED',
  );
});
