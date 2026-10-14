# ENV Contract

All keys are read directly by their canonical names in `src/config/env.ts`, following the User service configuration pattern. Update old deployment variables before starting Chat.

Secrets are never committed. Local values live in the untracked `.env`, runtime
values come from Vault (`chat-runtime`).

## Required in production

`env.ts` refuses to boot a production process without these keys:

| Key                      | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `DATABASE_URL`           | PostgreSQL connection string for Prisma                |
| `DEFAULT_TENANT_ID`      | Tenant used by provider callbacks that carry no tenant |
| `KC_URL`                 | Keycloak base URL                                      |
| `KC_CLIENT_SECRET`       | Client secret for the service account                  |
| `COOKIE_SECRET`          | Cookie signing secret                                  |
| `ENCRYPTION_KEY`         | Payload encryption key                                 |
| `VALKEY_URL`             | Valkey/Redis URL for Pub/Sub                           |
| `INTERNAL_GATEWAY_TOKEN` | Shared key for the internal REST endpoints             |
| `GATEWAY_BASE_URL`       | Communication Gateway base URL for outbound messages   |
| `GATEWAY_API_KEY`        | API key sent to the Gateway                            |

## Runtime

| Key                      | Default                       | Previous key                    | Notes                                                                   |
| ------------------------ | ----------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `NODE_ENV`               | `development`                 | `ENVIRONMENT`                   | `production` enables the required-key check                             |
| `PORT`                   | `8000`                        | —                               | Container port; local development uses `7409` (see below)               |
| `DATABASE_URL`           | —                             | —                               | Required in production                                                  |
| `DEFAULT_TENANT_ID`      | —                             | —                               | Required in production                                                  |
| `GATEWAY_BASE_URL`       | `http://localhost:8002`       | `COMMUNICATION_GATEWAY_URL`     |                                                                         |
| `GATEWAY_API_KEY`        | —                             | `COMMUNICATION_GATEWAY_API_KEY` | Required in production                                                  |
| `GATEWAY_TIMEOUT`        | `30000`                       | `COMMUNICATION_GATEWAY_TIMEOUT` | Milliseconds; the previous value was in seconds; configure milliseconds |
| `INTERNAL_GATEWAY_TOKEN` | —                             | `CHAT_SERVICE_API_KEY`          | Required in production                                                  |
| `KC_URL`                 | `http://localhost:18080/auth` | `KEYCLOAK_URL`                  |                                                                         |
| `KC_REALM`               | `camunda-platform`            | `KEYCLOAK_REALM`                |                                                                         |
| `KC_CLIENT_ID`           | `camunda-identity`            | `KEYCLOAK_CLIENT_ID`            |                                                                         |
| `KC_CLIENT_SECRET`       | —                             | `KEYCLOAK_CLIENT_SECRET`        | Required in production                                                  |
| `KC_AUDIENCE`            | —                             | `KEYCLOAK_AUDIENCE`             | Token audience, no default                                              |
| `VALKEY_URL`             | `valkey://localhost:6380`     | `CACHE_URL`                     | use a `valkey://` or `valkeys://` URL                 |
| `VALKEY_PASSWORD`        | —                             | `CACHE_PASSWORD`                |                                                                         |
| `COOKIE_SECRET`          | —                             | —                               | Required in production                                                  |
| `ENCRYPTION_KEY`         | —                             | —                               | Required in production                                                  |

## Analytics outbox

| Key                             | Default | Notes                                             |
| ------------------------------- | ------- | ------------------------------------------------- |
| `ANALYTICS_OUTBOX_ENABLED`      | `true`  | `false` keeps the writer but stops the drain loop |
| `ANALYTICS_OUTBOX_INTERVAL_MS`  | `1000`  | Drain interval                                    |
| `ANALYTICS_OUTBOX_BATCH_SIZE`   | `100`   | Rows claimed per drain                            |
| `ANALYTICS_OUTBOX_MAX_ATTEMPTS` | `5`     | Attempts before a row is dead lettered            |

## Messaging and realtime

| Key                        | Default          | Previous key              |
| -------------------------- | ---------------- | ------------------------- |
| `KAFKA_BROKER`             | `localhost:9092` | `KAFKA_BOOTSTRAP_SERVERS` |
| `KAFKA_RETRY`              | `5`              | —                         |
| `KAFKA_IDEMPOTENCY_ENABLE` | `true`           | —                         |
| `KAFKA_IDEMPOTENCY_TTL`    | `86400`          | —                         |

## Observability

| Key                           | Default                 | Previous key         |
| ----------------------------- | ----------------------- | -------------------- |
| `LOG_LEVEL`                   | `info`                  | —                    |
| `LOG_PRETTY`                  | `false`                 | —                    |
| `LOG_DIRECTORY`               | `log`                   | —                    |
| `LOG_BATCH_ENABLE`            | `true`                  | —                    |
| `LOG_BATCH_MAX_SIZE`          | `50`                    | —                    |
| `LOG_BATCH_FLUSH_INTERVAL`    | `2000`                  | —                    |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | `OTEL_OTLP_ENDPOINT` |
| `OTEL_TRANSPORT_MODE`         | `http`                  | —                    |
| `OTEL_SAMPLING_RATIO`         | `1`                     | —                    |
| `OTEL_LOGS_ENABLED`           | `true`                  | —                    |
| `PROMETHEUS_ENABLE`           | `true`                  | —                    |
| `PROMETHEUS_PORT`             | `9464`                  | —                    |

`KEYCLOAK_HEALTH_URL`, `TEMPO_HEALTH_URL` and `PROMETHEUS_HEALTH_URL` are optional;
when set, readiness additionally probes them.

## Ports

| Purpose                               | Port                    | Source                    |
| ------------------------------------- | ----------------------- | ------------------------- |
| HTTP (GraphQL, internal REST, health) | `8000` in the container | `PORT`, `Dockerfile`      |
| HTTP in local development             | `7409`                  | `docs/port-konvention.md` |
| Metrics                               | `9464`                  | `PROMETHEUS_PORT`         |

The container listens on `8000` while the platform convention reserves `7409` for
local development and `9409` for the metrics port. The deviation is tracked in the
root `ENV-DIFF.md`; the values above match Compose, staging, production and
Kubernetes, so they were not changed as part of the TypeScript migration.
