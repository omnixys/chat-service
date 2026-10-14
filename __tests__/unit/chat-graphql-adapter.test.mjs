import { ContextAccessor } from '@omnixys/context-ts';
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { of } from 'rxjs';

import {
  createInMemoryRepositories,
  makeLogger,
  makeRealtimePublisher,
} from '../support/in-memory.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const logger = makeLogger();
const correlationId = () => undefined;

/**
 * Behaviour of the GraphQL transport layer: the flat argument contract, the
 * validation that replaces `@InputType` objects and the subscription guards.
 *
 * The preserved schema passes plain scalars, so these tests pin the two things
 * that a schema-only check cannot see: that invalid scalars are refused before
 * any repository call, and that a subscription only opens its stream after the
 * participant check resolved.
 */
async function load(principal = defaultPrincipal()) {
  const repositories = createInMemoryRepositories();
  const [
    { ConversationWriteService },
    { ConversationReadService },
    { MessageWriteService },
    { MessageReadService },
    { ReadStateService },
    { GraphqlChatReadService },
    { GraphqlChatWriteService },
    { ChatResolver },
  ] = await Promise.all([
    import('../../dist/chat/services/conversation-write.service.js'),
    import('../../dist/chat/services/conversation-read.service.js'),
    import('../../dist/chat/services/message-write.service.js'),
    import('../../dist/chat/services/message-read.service.js'),
    import('../../dist/chat/services/read-state.service.js'),
    import('../../dist/chat/services/graphql-chat-read.service.js'),
    import('../../dist/chat/services/graphql-chat-write.service.js'),
    import('../../dist/chat/resolvers/chat.resolver.js'),
  ]);

  const conversationWrites = new ConversationWriteService(
    repositories.unitOfWork,
    logger,
  );
  const conversationReads = new ConversationReadService(
    repositories.unitOfWork,
  );
  const messageWrites = new MessageWriteService(
    repositories.unitOfWork,
    logger,
  );
  const messageReads = new MessageReadService(repositories.unitOfWork, logger);
  const readStates = new ReadStateService(repositories.unitOfWork, logger);
  const realtime = makeRealtimePublisher();

  const tenantId = principal.requireTenantId();
  const userId = principal.requireUserId();
  const snapshot = {
    requestId: 'test-request',
    correlationId: 'test-correlation',
    startedAtEpochMs: Date.now(),
    principal: {
      subject: userId,
      principalType: 'USER',
      userId,
      actorId: userId,
      tenantId,
      roles: [],
    },
    tenant: { tenantId, source: 'trusted-header', verified: true },
    client: {},
    transport: { type: 'graphql' },
  };
  const readService = new GraphqlChatReadService(
    conversationReads,
    messageReads,
  );
  const writeService = new GraphqlChatWriteService(
    conversationWrites,
    messageWrites,
    /** the dispatcher is never reached: dispatching needs channel adapters. */
    { dispatch: async () => assert.fail('dispatch must not run in this test') },
    readStates,
    logger,
  );
  const rawResolver = new ChatResolver(
    readService,
    writeService,
    conversationReads,
    messageReads,
    realtime,
  );
  const resolver = new Proxy(rawResolver, {
    get(target, key) {
      const value = target[key];
      return typeof value === 'function'
        ? (...args) =>
            ContextAccessor.run(snapshot, () => value.apply(target, args))
        : value;
    },
  });
  const read = {
    conversations: () => readService.conversations(tenantId, userId),
    conversation: (id) => readService.conversation(tenantId, userId, id),
    messages: (id, limit, before, beforeId) =>
      readService.messages(tenantId, userId, id, limit, before, beforeId),
  };
  const write = {
    createInAppConversation: (participantId, type) =>
      writeService.createInAppConversation(
        tenantId,
        userId,
        participantId,
        type,
      ),
    createWhatsappConversation: (phone, name) =>
      writeService.createWhatsappConversation(tenantId, userId, phone, name),
    sendMessage: (id, body, type) =>
      writeService.sendMessage(tenantId, userId, id, body, type),
    markRead: (id, at, messageId) =>
      writeService.markRead(tenantId, userId, id, at, messageId),
  };

  return {
    repositories,
    realtime,
    resolver,
    rawResolver,
    snapshot,
    read,
    write,
    conversationWrites,
    conversationReads,
    messageWrites,
    messageReads,
  };
}

/** A message from the other participant; unread counts exclude the caller's own. */
async function sendFromBob(messageWrites, conversationId, body) {
  return messageWrites.send({
    tenantId: TENANT,
    conversationId,
    senderId: BOB,
    body,
  });
}

function defaultPrincipal() {
  return {
    requireTenantId: () => TENANT,
    requireUserId: () => ALICE,
    correlationId,
  };
}

test('a conversation is projected with the preserved participant shape', async () => {
  const { write, read } = await load();
  const conversation = await write.createInAppConversation(BOB);

  assert.deepEqual(
    conversation.participants.map((participant) => participant.userId).sort(),
    [ALICE, BOB],
  );
  assert.equal(conversation.type, 'DIRECT');

  const projected = await read.conversation(conversation.id);
  assert.equal(projected.id, conversation.id);
  assert.deepEqual(projected.participants, [
    { userId: ALICE },
    { userId: BOB },
  ]);
});

test('a whatsapp conversation keeps the trimmed address and display name', async () => {
  const { write } = await load();
  const conversation = await write.createWhatsappConversation(
    '  +4915112345678  ',
    '  Alice  ',
  );
  assert.equal(conversation.externalAddress, '+4915112345678');
  assert.equal(conversation.externalDisplayName, 'Alice');
});

test('an invalid scalar is refused before any repository call', async () => {
  const { write, repositories } = await load();

  await assert.rejects(
    () => write.createWhatsappConversation('not-a-number'),
    invalidArgument('phoneNumber'),
  );
  await assert.rejects(
    () => write.createInAppConversation('nope'),
    invalidArgument('participantUserId'),
  );
  await assert.rejects(
    () => write.sendMessage('not-a-uuid', 'hi'),
    invalidArgument('conversationId'),
  );
  await assert.rejects(
    () => write.sendMessage(BOB, '   '),
    invalidArgument('body'),
  );

  assert.equal(repositories.stores.conversations.length, 0);
  assert.equal(repositories.stores.messages.length, 0);
});

test('an unsupported enum value is refused', async () => {
  const { write } = await load();
  await assert.rejects(
    () => write.createInAppConversation(BOB, 'BROADCAST'),
    invalidArgument('conversationType'),
  );
});

test('markRead answers a boolean and clears the unread count', async () => {
  const { write, messageReads, messageWrites } = await load();
  const conversation = await write.createInAppConversation(BOB);
  await sendFromBob(messageWrites, conversation.id, 'ping');
  assert.equal(
    await messageReads.countUnread(TENANT, ALICE, conversation.id),
    1,
  );

  assert.equal(await write.markRead(conversation.id), true);
  assert.equal(
    await messageReads.countUnread(TENANT, ALICE, conversation.id),
    0,
  );
});

test('the tenant always comes from the principal, never from an argument', async () => {
  const { write, repositories } = await load();
  const conversation = await write.createInAppConversation(BOB);
  await write.createWhatsappConversation('+4915199999999');

  assert.equal(repositories.stores.conversations.length, 2);
  assert.deepEqual(
    [...new Set(repositories.stores.conversations.map((row) => row.tenantId))],
    [TENANT],
  );

  const otherPrincipal = {
    requireTenantId: () => OTHER_TENANT,
    requireUserId: () => ALICE,
    correlationId,
  };
  const other = await load(otherPrincipal);
  assert.deepEqual(await other.read.conversations(), []);
  await assert.rejects(
    () => other.read.conversation(conversation.id),
    (error) => error.code === 'CONVERSATION_NOT_FOUND',
  );
});

test('messageReceived emits projected messages of the conversation channel', async () => {
  const { write, resolver, realtime, messageWrites } = await load();
  const conversation = await write.createInAppConversation(BOB);
  const { message } = await sendFromBob(messageWrites, conversation.id, 'ping');

  const emitted = [];
  resolver
    .messageReceived(conversation.id)
    .subscribe((model) => emitted.push(model));
  await flush();
  await realtime.publish(`conversation:${conversation.id}`, {
    messageId: message.id,
    conversationId: conversation.id,
    senderId: BOB,
    body: 'ping',
    contentType: 'TEXT',
    channel: 'IN_APP',
    deliveryStatus: 'SENT',
    createdAt: new Date().toISOString(),
  });
  await flush();

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].id, message.id);
  assert.equal(emitted[0].senderId, BOB);
  assert.equal(emitted[0].deletedAt, null);
});

test('a non-participant gets an errored stream and no open subscription', async () => {
  const alice = await load();
  const conversation = await alice.write.createInAppConversation(BOB);

  const outsider = defaultPrincipal();
  outsider.requireUserId = () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const mallory = await load(outsider);

  let opened = false;
  const original = mallory.realtime.subscribe.bind(mallory.realtime);
  mallory.realtime.subscribe = (channel) => {
    opened = true;
    return original(channel);
  };

  const error = await collectError(
    mallory.resolver.messageReceived(conversation.id),
  );

  assert.equal(error?.code, 'CONVERSATION_NOT_FOUND');
  assert.equal(
    opened,
    false,
    'the stream is never opened for a non-participant',
  );
  assert.deepEqual(mallory.realtime.published, []);
});

test('conversationUpdated re-reads the conversation of the event', async () => {
  const { write, resolver, realtime, messageWrites } = await load();
  const conversation = await write.createInAppConversation(BOB);
  await sendFromBob(messageWrites, conversation.id, 'ping');

  const models = [];
  resolver.conversationUpdated().subscribe((model) => models.push(model));
  await flush();
  await realtime.publish(`user:${ALICE}`, {
    messageId: '99999999-9999-4999-8999-999999999999',
    conversationId: conversation.id,
    senderId: ALICE,
    body: 'ping',
    contentType: 'TEXT',
    channel: 'IN_APP',
    deliveryStatus: 'SENT',
    createdAt: new Date().toISOString(),
  });
  await flush();

  assert.equal(models.length, 1);
  assert.equal(models[0].id, conversation.id);
  assert.equal(models[0].lastMessage, 'ping');
  assert.equal(models[0].lastMessageAt instanceof Date, true);
  assert.deepEqual(models[0].participants, [
    { userId: ALICE },
    { userId: BOB },
  ]);
});

test('unreadCount resolves against the principal of the caller', async () => {
  const { write, resolver, messageReads, messageWrites } = await load();
  const conversation = await write.createInAppConversation(BOB);
  await sendFromBob(messageWrites, conversation.id, 'ping');

  assert.equal(await resolver.unreadCount(conversation), 1);

  await assert.rejects(
    () => messageReads.countUnread(OTHER_TENANT, ALICE, conversation.id),
    (error) => error.code === 'CONVERSATION_NOT_FOUND',
    'a conversation of another tenant must not be countable',
  );
});

function invalidArgument(field) {
  return (error) =>
    error.code === 'MESSAGE_INPUT_INVALID' &&
    error.diagnostics.reason === 'graphql-argument-invalid' &&
    error.diagnostics.field === field;
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function collectError(observable) {
  return new Promise((resolve) => {
    observable.subscribe({ next: () => resolve(null), error: resolve });
  });
}

void of;

test('GraphQL rejects a missing user principal before reading chat data', async () => {
  const { rawResolver, snapshot } = await load();
  const withoutUser = {
    ...snapshot,
    principal: { ...snapshot.principal, userId: undefined },
  };
  assert.throws(
    () =>
      ContextAccessor.run(withoutUser, () => rawResolver.listConversations()),
    (error) => error.code === 'UNAUTHORIZED',
  );
});

test('GraphQL rejects an unverified tenant before reading chat data', async () => {
  const { rawResolver, snapshot } = await load();
  const unverified = {
    ...snapshot,
    tenant: { ...snapshot.tenant, verified: false },
  };
  assert.throws(
    () =>
      ContextAccessor.run(unverified, () => rawResolver.listConversations()),
    (error) => error.code === 'TENANT_CONTEXT_UNVERIFIED',
  );
});

test('GraphQL rejects a tenant different from the verified user tenant', async () => {
  const { rawResolver, snapshot } = await load();
  const mismatched = {
    ...snapshot,
    principal: { ...snapshot.principal, tenantId: OTHER_TENANT },
  };
  assert.throws(
    () =>
      ContextAccessor.run(mismatched, () => rawResolver.listConversations()),
    (error) => error.code === 'TENANT_CONTEXT_UNVERIFIED',
  );
});
