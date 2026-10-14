# Operations

## Endpoints

| Endpoint                                                                  | Purpose                                                                   | Auth                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| `GET /graphql`                                                            | GraphQL queries, mutations                                                | `HeaderAuthGuard` (Keycloak access token) |
| `GET /graphql` (upgrade)                                                  | `graphql-transport-ws` subscriptions                                      | same                                      |
| `GET /health/liveness`                                                    | process is alive                                                          | none                                      |
| `GET /health/readiness`                                                   | database, Valkey, Kafka, realtime, Gateway and configured external probes | none                                      |
| `GET /api/v1/internal/conversations/:conversationId/participants/:userId` | membership check for the Gateway                                          | `x-api-key`                               |
| `POST /api/v1/internal/inbound-message`                                   | Evolution/WhatsApp webhook                                                | `x-api-key`                               |
| `POST /api/v1/internal/delivery-status`                                   | provider delivery status                                                  | `x-api-key`                               |

There is no `/metrics` endpoint: the shared observability module accepts the
`metrics` options but starts no Prometheus exporter, and the Python implementation
did not serve one either. `PROMETHEUS_PORT` and `PROMETHEUS_ENABLE` are passed to
the module and reserved for a future exporter.

The internal endpoints fail closed: a missing `INTERNAL_GATEWAY_TOKEN` in the
configuration or a missing/wrong header answers `401`.

`GET /health/readiness` reports one indicator per dependency:
`database`, `cache`, `kafka`, `realtime`, `gateway`, plus `keycloak`, `tempo` and
`prometheus` when their health URL is configured. Liveness never touches a
dependency, so a slow database cannot cause restart loops.

## Realtime channels

| Channel                              | Payload               |
| ------------------------------------ | --------------------- |
| `chat:conversation:{conversationId}` | `MessageCreatedEvent` |
| `chat:user:{userId}`                 | `MessageCreatedEvent` |

The logical channels (`conversation:*`, `user:*`) are prefixed with `chat:` by
`transportChannel()` so the names stay identical to the previous implementation.

## Kafka topics

`chat.conversation.created.v1`, `chat.message.sent.v1`, `chat.message.received.v1`,
`chat.message.delivery-status-changed.v1`.

Facts are written inside the caller's transaction and drained afterwards by
`AnalyticsOutboxPublisher`:

- claim with a conditional update, so several replicas drain without publishing
  the same row twice;
- on failure, release with an exponential backoff capped at five minutes;
- after `ANALYTICS_OUTBOX_MAX_ATTEMPTS` the row is dead lettered, so a permanently
  failing topic cannot block the queue.

Monitor `SELECT count(*) FROM analytics_outbox WHERE published_at IS NULL AND
dead_lettered_at IS NULL;` — a growing number means the drain loop is not running.

## Database migrations

`prisma migrate deploy` runs on container start. For an existing Alembic-managed
database, mark the preserved history as applied first:

```bash
pnpm exec prisma migrate resolve --applied 20260101000000_chat_baseline
pnpm exec prisma migrate deploy
```

Never edit an applied migration. See `docs/CUTOVER.md`.

## Common failures

| Symptom                                                                                   | Cause                                                         | Action                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Boot fails with `Missing required production settings`                                    | `NODE_ENV=production` without a required key                  | set the keys listed in `docs/ENV.md`                                         |
| `[ENV] "…" is deprecated` warning                                                         | a legacy key is still configured                              | migrate to the canonical key                                                 |
| Readiness reports `cache: down`                                                           | `VALKEY_URL` uses a scheme the client rejects                 | use `valkey://` or `valkeys://`; `redis://` is rewritten automatically       |
| Inbound webhook answers `422`                                                             | the external address belongs to no conversation               | create the WhatsApp conversation first; the service never creates one itself |
| Inbound webhook answers `MESSAGE_INPUT_INVALID` with `inbound-external-address-ambiguous` | the address is claimed by two tenants                         | resolve the data conflict, the service refuses to guess                      |
| GraphQL answers `CONVERSATION_NOT_FOUND` for a known conversation                         | the caller is not a participant, or belongs to another tenant | the two cases are intentionally indistinguishable                            |

## Shutdown

`app.enableShutdownHooks()` stops accepting connections, closes the Fastify
adapter and stops the outbox drain loop. The Prisma connection is closed by its
own module hook.
