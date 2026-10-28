# Chat Service

Authenticated realtime chat over GraphQL HTTP and `graphql-transport-ws`.

- In-app conversations connect two registered users.
- WhatsApp conversations connect the authenticated app user with one normalized
  external E.164 phone number.
- Public operations derive the user and sender from the Keycloak principal.
- Conversation membership is checked for queries, mutations and subscriptions.
- The conversation fixes the channel; a client cannot select it per message.
- WhatsApp text is sent through the Communication Gateway. Inbound Evolution
  messages are matched only to an existing external-number conversation.
- Provider IDs are unique and repeated webhooks do not create duplicate messages.
- Realtime events use Valkey Pub/Sub; PostgreSQL remains the offline history.

V1 intentionally has no media, groups, reactions, typing indicators, presence,
email/SMS chat or automatic channel fallback.

## Stack

NestJS 11 on Fastify 5, Prisma 7, PostgreSQL, Valkey Pub/Sub, Kafka, pnpm.

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm run build
node dist/main
```

The GraphQL endpoint is `/graphql`, health is `/health/liveness` and
`/health/readiness`. Configuration is documented in `docs/ENV.md`.

## GraphQL contract

The schema is preserved from the previous implementation:

```graphql
type Query {
  conversations: [Conversation!]!
  conversation(id: ID!): Conversation
  messages(
    conversationId: ID!
    limit: Int = 50
    before: DateTime
    beforeId: ID
  ): [Message!]!
}

type Mutation {
  createInAppConversation(
    participantUserId: String!
    conversationType: ConversationType = DIRECT
  ): Conversation!
  createWhatsappConversation(
    phoneNumber: String!
    displayName: String
  ): Conversation!
  sendMessage(
    conversationId: ID!
    body: String!
    contentType: MessageContentType = TEXT
  ): Message!
  markRead(
    conversationId: ID!
    lastReadAt: DateTime
    lastReadMessageId: ID
  ): Boolean!
}

type Subscription {
  messageReceived(conversationId: ID!): Message!
  conversationUpdated: Conversation!
}
```

`__tests__/contract/chat-graphql-schema.test.mjs` builds the schema from the
compiled resolver and fails when a signature drifts.

## Internal API

Consumed by the Gateway and the provider webhooks, authenticated with
`x-api-key` against `INTERNAL_GATEWAY_TOKEN`:

| Method | Path                                                                  |
| ------ | --------------------------------------------------------------------- |
| `GET`  | `/api/v1/internal/conversations/:conversationId/participants/:userId` |
| `POST` | `/api/v1/internal/inbound-message`                                    |
| `POST` | `/api/v1/internal/delivery-status`                                    |

## Development

```bash
pnpm run typecheck      # tsc --noEmit
pnpm run lint:check     # eslint, check only
pnpm run format:check   # prettier
pnpm test               # build + node --test (unit + contract)
pnpm run prisma:validate
```

The test suite runs against in-memory port doubles and needs no PostgreSQL,
Kafka, Valkey or Keycloak. See `AGENTS.md` for the architecture and
`SKILL.md` for the workflow.

## Documentation

| Document                                       | Content                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `docs/ENV.md`                                  | environment contract, legacy keys, ports                         |
| `docs/OPERATIONS.md`                           | endpoints, realtime channels, Kafka topics, failure modes        |
| `docs/PORTING-NOTES.md`                        | every deliberate behaviour change from the Python implementation |
| `docs/CUTOVER.md`                              | migration and cutover procedure for the existing database        |
| `docs/adr/001_channel_adapter_architecture.md` | why delivery fans out to one channel                             |
