// @covers InternalChatController.verifyParticipant
// @covers InternalChatController.inboundMessage
// @covers InternalChatController.deliveryStatus
// @covers ChatResolver.listConversations
// @covers ChatResolver.getConversation
// @covers ChatResolver.listMessages
// @covers ChatResolver.createInAppConversation
// @covers ChatResolver.createWhatsappConversation
// @covers ChatResolver.sendMessage
// @covers ChatResolver.markRead
// @covers ChatResolver.unreadCount
// @covers ChatResolver.messageReceived
// @covers ChatResolver.conversationUpdated
// @covers HealthController.liveness
// @covers HealthController.readiness
import { kafkaObserver } from '../../../test-tools/local-kafka-observer.mjs';
import { localNestApp } from '../../../test-tools/local-nest-app.mjs';
import { moduleArrayFederation } from '../../../test-tools/local-nest-hooks.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { firstValueFrom } from 'rxjs';

let fixture;
let publisher;
let observer;
let realtime;
let gatewayStatus = 200;
const calls = [];
const peer = '019a08da-6000-7000-8000-000000000002';
const conversationFields =
  'id type channel participants{userId} unreadCount externalAddress externalDisplayName';
before(async () => {
  fixture = await localNestApp('chat', {
    validation: {
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    },
    configureEnvironment({ providerUrl }) {
      Object.assign(process.env, {
        INTERNAL_GATEWAY_TOKEN: 'integration-chat-key',
        GATEWAY_BASE_URL: providerUrl,
        GATEWAY_API_KEY: 'integration-provider-key',
        GATEWAY_TIMEOUT: '10000',
        AUTH_HEALTH_URL: providerUrl,
        USER_HEALTH_URL: providerUrl,
        ANALYTICS_OUTBOX_ENABLED: 'false',
      });
    },
    async externalHandler(request, response) {
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
      }
      calls.push({
        path: request.url,
        headers: request.headers,
        body: raw ? JSON.parse(raw) : null,
      });
      response.writeHead(request.method === 'POST' ? gatewayStatus : 200, {
        'content-type': 'application/json',
      });
      response.end(
        JSON.stringify({
          success: gatewayStatus === 200,
          status: 'SENT',
          providerMessageId: randomUUID(),
        }),
      );
    },
    async beforeInit(app, imports) {
      await moduleArrayFederation(app, imports);
    },
  });
  const { AnalyticsOutboxPublisher } =
    await import('../../dist/analytics/analytics-outbox.js');
  const { ValkeyRealtimePublisher } =
    await import('../../dist/adapter/realtime/valkey-realtime.publisher.js');
  publisher = fixture.app.get(AnalyticsOutboxPublisher);
  realtime = fixture.app.get(ValkeyRealtimePublisher);
  observer = await kafkaObserver(fixture.database.name, [
    'chat.conversation.created.v1',
    'chat.message.sent.v1',
  ]);
});
after(async () => {
  await observer?.close();
  await fixture?.close();
});
beforeEach(async () => {
  await fixture.reset();
  calls.length = 0;
  gatewayStatus = 200;
});
function data(response, name) {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(
    response.body.errors,
    undefined,
    JSON.stringify(response.body.errors),
  );
  return response.body.data[name];
}
async function create(options = {}) {
  return data(
    await fixture.graphql(
      `mutation($peer:String!){createInAppConversation(participantUserId:$peer){${conversationFields}}}`,
      { peer },
      options,
    ),
    'createInAppConversation',
  );
}
async function whatsapp() {
  return data(
    await fixture.graphql(
      `mutation{createWhatsappConversation(phoneNumber:"+49123456789",displayName:"External"){${conversationFields}}}`,
    ),
    'createWhatsappConversation',
  );
}
async function send(id, body = 'Message', options = {}) {
  return fixture.graphql(
    'mutation($id:ID!,$body:String!){sendMessage(conversationId:$id,body:$body){id conversationId senderId body deliveryStatus channel}}',
    { id, body },
    options,
  );
}
async function http(
  path,
  body,
  headers = { 'x-api-key': 'integration-chat-key' },
) {
  const response = await fetch(`${fixture.baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function seedConversation(
  tenant = fixture.tenantId,
  actor = fixture.actorId,
) {
  const id = randomUUID();
  await fixture.database.query(
    'INSERT INTO conversations(id,tenant_id,participant_pair_key,created_at,updated_at) VALUES($1,$2,$3,now(),now())',
    [id, tenant, `${tenant}:${actor}:${peer}`],
  );
  await fixture.database.query(
    'INSERT INTO conversation_participants(id,tenant_id,conversation_id,user_id) VALUES($1,$3,$4,$5),($2,$3,$4,$6)',
    [randomUUID(), randomUUID(), tenant, id, actor, peer],
  );
  return id;
}
async function seedMessage(
  id,
  { sender = peer, created = '2026-01-01T00:00:00Z', deleted = null } = {},
) {
  const messageId = randomUUID();
  await fixture.database.query(
    'INSERT INTO messages(id,tenant_id,conversation_id,sender_id,body,created_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [messageId, fixture.tenantId, id, sender, messageId, created, deleted],
  );
  return messageId;
}

test('direct conversation creation commits participants and a transactional outbox fact', async () => {
  const created = await create();
  assert.equal(created.type, 'DIRECT');
  assert.deepEqual(
    created.participants.map((participant) => participant.userId).sort(),
    [fixture.actorId, peer],
  );
  assert.equal(created.unreadCount, 0);
  const stored = (
    await fixture.database.query('SELECT * FROM conversations WHERE id=$1', [
      created.id,
    ])
  ).rows[0];
  assert.equal(stored.tenant_id, fixture.tenantId);
  const fact = (await fixture.database.query('SELECT * FROM analytics_outbox'))
    .rows[0];
  assert.equal(fact.topic, 'chat.conversation.created.v1');
  assert.equal(fact.payload.aggregateId, created.id);
  assert.equal(fact.actor_id, fixture.actorId);
});

test('concurrent direct creates converge on one conversation and one creation fact', async () => {
  const results = await Promise.all([create(), create(), create()]);
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(
    (
      await fixture.database.query(
        'SELECT count(*)::int AS count FROM conversations',
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (
      await fixture.database.query(
        'SELECT count(*)::int AS count FROM analytics_outbox',
      )
    ).rows[0].count,
    1,
  );
});

test('self-conversation, invalid participants and unsupported types are rejected without writes', async () => {
  for (const participant of [fixture.actorId, '']) {
    assert.ok(
      (
        await fixture.graphql(
          'mutation($peer:String!){createInAppConversation(participantUserId:$peer){id}}',
          { peer: participant },
        )
      ).body.errors?.length,
    );
    assert.equal(
      (
        await fixture.database.query(
          'SELECT count(*)::int AS count FROM conversations',
        )
      ).rows[0].count,
      0,
    );
  }
});

test('WhatsApp address normalization is idempotent and another principal cannot claim it', async () => {
  const first = await whatsapp();
  const second = await whatsapp();
  assert.equal(first.id, second.id);
  assert.equal(first.externalAddress, '+49123456789');
  const foreign = await fixture.graphql(
    'mutation{createWhatsappConversation(phoneNumber:"+49123456789"){id}}',
    {},
    { claims: { omnixys_user_id: peer } },
  );
  assert.ok(foreign.body.errors?.length);
  assert.ok(
    (
      await fixture.graphql(
        'mutation{createWhatsappConversation(phoneNumber:"invalid"){id}}',
      )
    ).body.errors?.length,
  );
  assert.equal(
    (
      await fixture.database.query(
        'SELECT count(*)::int AS count FROM conversations',
      )
    ).rows[0].count,
    1,
  );
});

test('in-app message dispatch persists body, sender and delivery facts', async () => {
  const conversation = await create();
  const message = data(await send(conversation.id), 'sendMessage');
  assert.equal(message.senderId, fixture.actorId);
  const stored = (
    await fixture.database.query('SELECT * FROM messages WHERE id=$1', [
      message.id,
    ])
  ).rows[0];
  assert.equal(stored.body, 'Message');
  assert.equal(stored.tenant_id, fixture.tenantId);
  assert.equal(stored.delivery_status, message.deliveryStatus);
  assert.ok(
    (
      await fixture.database.query(
        "SELECT * FROM analytics_outbox WHERE payload->>'aggregateId'=$1",
        [message.id],
      )
    ).rows.length >= 1,
  );
});

test('WhatsApp uses a local HTTP double and records provider failure after committing the message', async () => {
  const conversation = await whatsapp();
  const success = data(await send(conversation.id, 'Delivered'), 'sendMessage');
  assert.equal(success.deliveryStatus, 'SENT');
  assert.equal(
    calls.find((call) => call.path.endsWith('/send')).headers[
      'x-internal-api-key'
    ],
    'integration-provider-key',
  );
  gatewayStatus = 503;
  const failed = data(await send(conversation.id, 'Retained'), 'sendMessage');
  assert.equal(failed.deliveryStatus, 'FAILED');
  assert.equal(
    (
      await fixture.database.query('SELECT body FROM messages WHERE id=$1', [
        failed.id,
      ])
    ).rows[0].body,
    'Retained',
  );
});

test('conversation reads and unread fields exclude foreign tenants and nonparticipants', async () => {
  const own = await seedConversation();
  const foreign = await seedConversation(randomUUID());
  await seedConversation(
    fixture.tenantId,
    '019a08da-6000-7000-8000-000000000003',
  );
  await seedMessage(own);
  await seedMessage(own, { sender: fixture.actorId });
  await seedMessage(own, { deleted: '2026-01-02T00:00:00Z' });
  const conversations = data(
    await fixture.graphql(`{conversations{${conversationFields}}}`),
    'conversations',
  );
  assert.deepEqual(
    conversations.map((conversation) => conversation.id),
    [own],
  );
  assert.equal(conversations[0].unreadCount, 1);
  assert.equal(
    data(
      await fixture.graphql(
        'query($id:ID!){conversation(id:$id){id unreadCount}}',
        { id: own },
      ),
      'conversation',
    ).unreadCount,
    1,
  );
  assert.ok(
    (
      await fixture.graphql('query($id:ID!){conversation(id:$id){id}}', {
        id: foreign,
      })
    ).body.errors?.length,
  );
});

test('message pagination compares independently seeded rows and handles limits and foreign targets', async () => {
  const conversation = await seedConversation();
  const older = await seedMessage(conversation);
  const newer = await seedMessage(conversation, {
    created: '2026-01-02T00:00:00Z',
  });
  const query =
    'query($id:ID!,$limit:Int,$before:DateTime,$beforeId:ID){messages(conversationId:$id,limit:$limit,before:$before,beforeId:$beforeId){id body}}';
  assert.deepEqual(
    data(
      await fixture.graphql(query, { id: conversation, limit: 1 }),
      'messages',
    ),
    [{ id: newer, body: newer }],
  );
  assert.deepEqual(
    data(
      await fixture.graphql(query, {
        id: conversation,
        before: '2026-01-02T00:00:00Z',
        beforeId: newer,
      }),
      'messages',
    ),
    [{ id: older, body: older }],
  );
  assert.ok(
    (await fixture.graphql(query, { id: conversation, limit: -1 })).body.errors
      ?.length,
  );
  assert.ok(
    (await fixture.graphql(query, { id: randomUUID() })).body.errors?.length,
  );
});

test('markRead persists a cursor and prevents another principal from changing read state', async () => {
  const conversation = await seedConversation();
  const message = await seedMessage(conversation);
  const query =
    'mutation($id:ID!,$message:ID!){markRead(conversationId:$id,lastReadMessageId:$message)}';
  assert.equal(
    data(
      await fixture.graphql(query, { id: conversation, message }),
      'markRead',
    ),
    true,
  );
  const stored = (
    await fixture.database.query(
      'SELECT * FROM read_states WHERE conversation_id=$1',
      [conversation],
    )
  ).rows[0];
  assert.equal(stored.user_id, fixture.actorId);
  assert.equal(stored.last_read_message_id, message);
  assert.equal(
    data(
      await fixture.graphql(
        'query($id:ID!){conversation(id:$id){unreadCount}}',
        { id: conversation },
      ),
      'conversation',
    ).unreadCount,
    0,
  );
  assert.ok(
    (
      await fixture.graphql(
        query,
        { id: conversation, message },
        { claims: { omnixys_user_id: '019a08da-6000-7000-8000-000000000003' } },
      )
    ).body.errors?.length,
  );
});

test('unsigned, expired and wrong-audience tokens are rejected by the real guard', async () => {
  for (const options of [
    { unsigned: true },
    { claims: { exp: 1 } },
    { claims: { aud: 'wrong' } },
  ]) {
    assert.ok(
      (await fixture.graphql('{conversations{id}}', {}, options)).body.errors
        ?.length,
    );
  }
  assert.ok((await send(randomUUID(), '')).body.errors?.length);
});

test('internal participant verification retains its 204, 403, 404 and authentication contracts', async () => {
  const conversation = await seedConversation();
  const path = `/api/v1/internal/conversations/${conversation}/participants/`;
  assert.equal((await http(path + fixture.actorId)).status, 204);
  assert.equal((await http(path + randomUUID())).status, 403);
  assert.equal(
    (
      await http(
        `/api/v1/internal/conversations/${randomUUID()}/participants/${fixture.actorId}`,
      )
    ).status,
    404,
  );
  assert.equal((await http(path + fixture.actorId, undefined, {})).status, 401);
});

test('internal inbound messages are persisted once and duplicates retain the original body', async () => {
  const conversation = await whatsapp();
  const input = {
    message_id: randomUUID(),
    channel: 'WHATSAPP',
    from_: '+49123456789',
    body: 'Inbound',
    conversation_id: conversation.id,
  };
  const first = await http('/api/v1/internal/inbound-message', input);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await http('/api/v1/internal/inbound-message', {
    ...input,
    body: 'Duplicate',
  });
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.id, first.body.id);
  assert.equal(
    (
      await fixture.database.query('SELECT body FROM messages WHERE id=$1', [
        first.body.id,
      ])
    ).rows[0].body,
    'Inbound',
  );
  assert.equal(
    (
      await fixture.database.query(
        'SELECT count(*)::int AS count FROM messages',
      )
    ).rows[0].count,
    1,
  );
});

test('delivery callbacks update only the resolved message and reject invalid input', async () => {
  const conversation = await whatsapp();
  const sent = data(await send(conversation.id), 'sendMessage');
  const stored = (
    await fixture.database.query('SELECT * FROM messages WHERE id=$1', [
      sent.id,
    ])
  ).rows[0];
  const input = {
    provider_message_id: stored.provider_message_id,
    internal_message_id: sent.id,
    status: 'DELIVERED',
  };
  const response = await http('/api/v1/internal/delivery-status', input);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(
    (
      await fixture.database.query(
        'SELECT delivery_status FROM messages WHERE id=$1',
        [sent.id],
      )
    ).rows[0].delivery_status,
    'DELIVERED',
  );
  assert.equal(
    (
      await http('/api/v1/internal/delivery-status', {
        ...input,
        status: 'INVALID',
      })
    ).status,
    400,
  );
});

test('actual Valkey realtime transport delivers and releases the last listener', async () => {
  const channel = `conversation:${randomUUID()}`;
  let resolve;
  let timer;
  const received = new Promise((done, reject) => {
    resolve = done;
    timer = setTimeout(() => reject(new Error('Realtime deadline')), 10_000);
  });
  const listener = realtime.subscribe(channel).subscribe({ next: resolve });
  try {
    await realtime.transitions.get(channel);
    const event = {
      messageId: randomUUID(),
      conversationId: channel.split(':')[1],
      senderId: fixture.actorId,
      body: 'Realtime',
      contentType: 'TEXT',
      channel: 'IN_APP',
      deliveryStatus: 'SENT',
      createdAt: new Date().toISOString(),
    };
    await realtime.publish(channel, event);
    assert.deepEqual(await received, event);
  } finally {
    clearTimeout(timer);
    listener.unsubscribe();
    await realtime.transitions.get(channel);
  }
  assert.equal(realtime.streams.has(channel), false);
});

test('subscription schema exists but the current application has no WebSocket upgrade transport', async () => {
  const { default: WebSocket } = await fixture.imports('ws');
  const status = await new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${fixture.baseUrl.replace('http:', 'ws:')}/graphql`,
      'graphql-transport-ws',
    );
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket handshake deadline'));
    }, 10_000);
    socket.on('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      socket.terminate();
      resolve(response.statusCode);
    });
    socket.on('open', () => {
      clearTimeout(timer);
      socket.close();
      resolve(101);
    });
    socket.on('error', () => {});
  });
  assert.notEqual(
    status,
    101,
    'Production module currently does not configure subscriptions',
  );
});

test('outbox publication sends real Kafka records and records publication in PostgreSQL', async () => {
  const conversation = await create();
  assert.equal(await publisher.drainOnce(50, 3), 1);
  const record = await observer.waitFor(
    (record) =>
      record.topic === 'chat.conversation.created.v1' &&
      record.value.payload?.aggregateId === conversation.id,
  );
  assert.equal(record.value.payload.tenantId, fixture.tenantId);
  assert.ok(
    (await fixture.database.query('SELECT published_at FROM analytics_outbox'))
      .rows[0].published_at instanceof Date,
  );
  assert.equal(await publisher.drainOnce(50, 3), 0);
});

test('health: liveness and readiness report up when dependencies resolve', async () => {
  for (const endpoint of ['liveness', 'readiness']) {
    const response = await fetch(`${fixture.baseUrl}/health/${endpoint}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.details.app.status, 'up');
  }
});

async function waitForChannelTransition(channel) {
  const deadline = Date.now() + 5000;
  while (!realtime.transitions.has(channel)) {
    if (Date.now() > deadline) {
      throw new Error(`realtime channel was never attached: ${channel}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  await realtime.transitions.get(channel);
}

test('message subscription enforces participant access, projects events and releases listeners on the real transport', async () => {
  const conversation = await seedConversation();
  const { ContextAccessor } = await fixture.imports('@omnixys/context-ts');
  const { PrincipalType } = await fixture.imports('@omnixys/contracts-ts');
  const { ChatResolver } =
    await import('../../dist/chat/resolvers/chat.resolver.js');
  const { conversationChannel } =
    await import('../../dist/adapter/realtime/realtime.events.js');
  const resolver = fixture.app.get(ChatResolver);
  const context = {
    tenant: { tenantId: fixture.tenantId, verified: true, source: 'principal' },
    principal: {
      principalType: PrincipalType.USER,
      userId: fixture.actorId,
      actorId: fixture.actorId,
      tenantId: fixture.tenantId,
      roles: [],
      subject: 'keycloak-opaque-sub',
    },
    correlationId: randomUUID(),
  };
  const channel = conversationChannel(conversation);
  const first = firstValueFrom(
    ContextAccessor.run(context, () => resolver.messageReceived(conversation)),
  );
  await waitForChannelTransition(channel);
  const sent = {
    messageId: randomUUID(),
    conversationId: conversation,
    senderId: peer,
    body: 'Realtime',
    contentType: 'TEXT',
    channel: 'IN_APP',
    deliveryStatus: 'SENT',
    createdAt: new Date().toISOString(),
  };
  await realtime.publish(channel, sent);
  assert.deepEqual(await first, {
    id: sent.messageId,
    conversationId: conversation,
    senderId: peer,
    body: 'Realtime',
    contentType: 'TEXT',
    channel: 'IN_APP',
    deliveryStatus: 'SENT',
    createdAt: new Date(sent.createdAt),
    editedAt: null,
    deletedAt: null,
  });
  await realtime.transitions.get(channel);
  assert.equal(realtime.streams.has(channel), false);
});

test('denied message subscription propagates the access failure without attaching realtime', async () => {
  const { ContextAccessor } = await fixture.imports('@omnixys/context-ts');
  const { PrincipalType } = await fixture.imports('@omnixys/contracts-ts');
  const { ChatResolver } =
    await import('../../dist/chat/resolvers/chat.resolver.js');
  const { conversationChannel } =
    await import('../../dist/adapter/realtime/realtime.events.js');
  const resolver = fixture.app.get(ChatResolver);
  const context = {
    tenant: { tenantId: fixture.tenantId, verified: true, source: 'principal' },
    principal: {
      principalType: PrincipalType.USER,
      userId: fixture.actorId,
      actorId: fixture.actorId,
      tenantId: fixture.tenantId,
      roles: [],
      subject: 'keycloak-opaque-sub',
    },
    correlationId: randomUUID(),
  };
  const foreign = await seedConversation(randomUUID());
  const channel = conversationChannel(foreign);
  await assert.rejects(
    firstValueFrom(
      ContextAccessor.run(context, () => resolver.messageReceived(foreign)),
    ),
  );
  assert.equal(realtime.streams.has(channel), false);
});

test('conversation update subscription re-reads the authorized conversation and projects it', async () => {
  const conversation = await seedConversation();
  const { ContextAccessor } = await fixture.imports('@omnixys/context-ts');
  const { PrincipalType } = await fixture.imports('@omnixys/contracts-ts');
  const { ChatResolver } =
    await import('../../dist/chat/resolvers/chat.resolver.js');
  const { userChannel } =
    await import('../../dist/adapter/realtime/realtime.events.js');
  const resolver = fixture.app.get(ChatResolver);
  const context = {
    tenant: { tenantId: fixture.tenantId, verified: true, source: 'principal' },
    principal: {
      principalType: PrincipalType.USER,
      userId: fixture.actorId,
      actorId: fixture.actorId,
      tenantId: fixture.tenantId,
      roles: [],
      subject: 'keycloak-opaque-sub',
    },
    correlationId: randomUUID(),
  };
  const channel = userChannel(fixture.actorId);
  const first = firstValueFrom(
    ContextAccessor.run(context, () => resolver.conversationUpdated()),
  );
  await waitForChannelTransition(channel);
  await realtime.publish(channel, {
    messageId: randomUUID(),
    conversationId: conversation,
    senderId: peer,
    body: 'Change',
    contentType: 'TEXT',
    channel: 'IN_APP',
    deliveryStatus: 'SENT',
    createdAt: new Date().toISOString(),
  });
  const model = await first;
  assert.equal(model.id, conversation);
  assert.deepEqual(
    model.participants.map((participant) => participant.userId).sort(),
    [fixture.actorId, peer].sort(),
  );
  await realtime.transitions.get(channel);
  assert.equal(realtime.streams.has(channel), false);
});
