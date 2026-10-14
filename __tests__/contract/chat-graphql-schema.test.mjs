import { strict as assert } from 'node:assert';
import test from 'node:test';

/**
 * Schema guard for the preserved GraphQL contract.
 *
 * The schema is built from the compiled resolver without any infrastructure, so a
 * renamed field, argument or nullability cannot reach a client unnoticed. Only the
 * signatures that external clients depend on are asserted; additive optional
 * arguments are allowed and ignored here.
 */
const { printSchema, parse, validateSchema } = await import('graphql');
const { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } =
  await import('@nestjs/graphql');
const { NestFactory } = await import('@nestjs/core');
const { ChatResolver } =
  await import('../../dist/chat/resolvers/chat.resolver.js');

const app = await NestFactory.createApplicationContext(
  GraphQLSchemaBuilderModule,
  {
    logger: false,
  },
);
const schema = await app.get(GraphQLSchemaFactory).create([ChatResolver]);
await app.close();

const sdl = printSchema(schema);

test('the generated schema is a valid GraphQL schema', () => {
  assert.deepEqual(validateSchema(schema), []);
});

test('the object types keep the preserved fields', () => {
  assert.match(sdl, /type Participant \{\s+userId: ID!\s+\}/);
  assert.match(sdl, /participants: \[Participant!\]!/);
  assert.match(
    sdl,
    /type Message \{[^}]*id: ID![^}]*conversationId: ID![^}]*senderId: String![^}]*body: String![^}]*contentType: MessageContentType![^}]*channel: ChannelType![^}]*deliveryStatus: DeliveryStatus![^}]*createdAt: DateTime![^}]*editedAt: DateTime[^}]*deletedAt: DateTime[^}]*\}/,
  );
});

test('the queries keep the preserved argument names', () => {
  const query = schema.getQueryType();
  assert.ok(query);
  const fields = query.getFields();

  assert.deepEqual(Object.keys(fields).sort(), [
    'conversation',
    'conversations',
    'messages',
  ]);

  const conversation = String(fields['conversation']?.type);
  assert.equal(conversation, 'Conversation');
  assert.deepEqual(argsOf(fields['conversation']), { id: 'ID!' });

  const messages = fields['messages'];
  assert.deepEqual(Object.keys(argsOf(messages)), [
    'conversationId',
    'limit',
    'before',
    'beforeId',
  ]);
  assert.equal(argsOf(messages)['conversationId'], 'ID!');
  assert.equal(argsOf(messages)['limit'], 'Int = 50');
  assert.equal(argsOf(messages)['before'], 'DateTime');
});

test('the mutations keep the preserved argument names and return types', () => {
  const mutation = schema.getMutationType();
  assert.ok(mutation);
  const fields = mutation.getFields();

  assert.deepEqual(Object.keys(fields).sort(), [
    'createInAppConversation',
    'createWhatsappConversation',
    'markRead',
    'sendMessage',
  ]);

  assert.deepEqual(argsOf(fields['createInAppConversation']), {
    participantUserId: 'String!',
    conversationType: 'ConversationType = "DIRECT"',
  });
  assert.deepEqual(argsOf(fields['createWhatsappConversation']), {
    phoneNumber: 'String!',
    displayName: 'String',
  });
  assert.deepEqual(argsOf(fields['sendMessage']), {
    conversationId: 'ID!',
    body: 'String!',
    contentType: 'MessageContentType = "TEXT"',
  });
  assert.deepEqual(argsOf(fields['markRead']), {
    conversationId: 'ID!',
    lastReadAt: 'DateTime',
    lastReadMessageId: 'ID',
  });
  assert.equal(String(fields['markRead']?.type), 'Boolean!');
});

test('the subscriptions keep the preserved argument names', () => {
  const subscription = schema.getSubscriptionType();
  assert.ok(subscription);
  const fields = subscription.getFields();

  assert.deepEqual(Object.keys(fields).sort(), [
    'conversationUpdated',
    'messageReceived',
  ]);
  assert.deepEqual(argsOf(fields['messageReceived']), {
    conversationId: 'ID!',
  });
  assert.deepEqual(argsOf(fields['conversationUpdated']), {});
  assert.equal(String(fields['conversationUpdated']?.type), 'Conversation!');
});

function argsOf(field) {
  const result = {};
  for (const arg of field?.args ?? []) {
    const defaultValue =
      arg.defaultValue === undefined
        ? ''
        : ` = ${JSON.stringify(arg.defaultValue)}`;
    result[arg.name] =
      `${String(arg.type).replace(/!$/, '')}${arg.type.toString().endsWith('!') ? '!' : ''}${defaultValue}`;
  }
  return result;
}

void parse;
