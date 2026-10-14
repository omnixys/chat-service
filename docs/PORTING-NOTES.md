# Porting Notes: FastAPI/Strawberry to NestJS

Behaviour that a consumer can observe is preserved. This document lists every
place where the TypeScript implementation had to decide something, and what it
decided. The removed Python sources are in the Git history, so the old behaviour
can always be compared against `git show b13d9b2^:src/chat/...`.

## Contracts that did not change

- GraphQL operations, argument names, field names and nullability.
- The internal REST endpoints, their status codes and the `x-api-key` header.
- Kafka topic names and the event envelope.
- Valkey channel names `chat:conversation:{conversationId}` and
  `chat:user:{userId}`.
- The provider message id as the idempotency key of inbound webhooks.

`__tests__/contract/chat-graphql-schema.test.mjs` builds the schema from the
compiled resolver and asserts the signatures, so a silent rename fails the suite.

## Deliberate behaviour changes

| Topic                            | Before                                                                          | Now                                                                             | Why                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Membership failure               | `CONVERSATION_ACCESS_DENIED` or `CONVERSATION_NOT_FOUND`, depending on the path | always `CONVERSATION_NOT_FOUND` on every caller-facing path                     | An unknown id and a foreign id are indistinguishable, so a conversation id cannot be probed. Only the trusted gateway endpoint answers `403`/`404`. Membership is now checked before the conversation is loaded, so even the lookup order no longer differs. |
| Page size                        | passed through to the query                                                     | clamped to `1..200`, default `50`                                               | A client cannot request the whole table. `beforeId` was added as an optional keyset tie-breaker.                                                                                                                                                             |
| Keyset pagination                | ordered by `createdAt`                                                          | ordered by `(createdAt, id)`                                                    | Messages created in the same millisecond no longer make a cursor skip or repeat rows.                                                                                                                                                                        |
| Read cursor                      | last write wins                                                                 | atomic upsert that never moves backwards                                        | Two devices with a stale cursor cannot resurrect read messages as unread.                                                                                                                                                                                    |
| Delivery status                  | reassigned freely                                                               | monotonic transitions, terminal states are final                                | A late provider webhook cannot move a delivered message back to sent.                                                                                                                                                                                        |
| Ambiguous inbound address        | resolved to the first match                                                     | refused with `inbound-external-address-ambiguous`                               | An address owned by two tenants must never be resolved by guessing.                                                                                                                                                                                          |
| Unknown inbound address          | matched heuristically                                                           | refused with `MESSAGE_INPUT_INVALID`, reason `unmatched-inbound-message`, `422` | The service never creates a conversation for an unknown sender.                                                                                                                                                                                              |
| Unknown inbound `conversationId` | `MESSAGE_INPUT_INVALID`                                                         | `CONVERSATION_NOT_FOUND`                                                        | The provider referenced a conversation this service does not know.                                                                                                                                                                                           |
| Error details                    | free-form metadata                                                              | `diagnostics`                                                                   | `metadata` is filtered to the public keys of the error code, so anything else was silently dropped.                                                                                                                                                          |
| Outbox drain                     | started manually                                                                | started on application bootstrap                                                | An outbox that is never drained grows the table and drops every event.                                                                                                                                                                                       |

## Additive GraphQL arguments

Every argument below is optional, so existing documents keep working:

- `messages(beforeId: ID)`
- `sendMessage(contentType: MessageContentType = TEXT)`
- `markRead(lastReadAt: DateTime, lastReadMessageId: ID)`

`markRead` answers `Boolean!`, as before. Called with only `conversationId` it
marks everything as read up to the server clock.

## Additive object fields

`Conversation` also exposes `createdAt` and `updatedAt`. Clients that never select
them are unaffected.

## What the Python implementation could not express

- `Conversation.unreadCount` was a per-user value carried on a shared row and was
  always `0`. It is now resolved per caller by `ChatResolver.unreadCount`, so the
  list query does not fan out into one count query per conversation.
- The Python argument objects were unvalidated. The flat contract has no
  `@InputType` for the global `ValidationPipe`, so
  `src/chat/models/inputs/graphql-args.ts` validates at the same boundary and
  raises the same `MESSAGE_INPUT_INVALID` error the REST transport raises.

## Environment

Chat now reads canonical environment keys using the User service pattern. Convert old deployment values before starting:

- Convert `COMMUNICATION_GATEWAY_TIMEOUT` seconds to `GATEWAY_TIMEOUT` milliseconds.
- Convert `CACHE_URL=redis://…` to `VALKEY_URL=valkey://…`, because the shared cache client
  only accepts the `valkey`/`valkeys` schemes.
