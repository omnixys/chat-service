# Cutover: Python to TypeScript

The TypeScript service replaces the FastAPI/Strawberry implementation in place.
The externally observable contracts are unchanged, so the Gateway, the frontend
and the communication gateway need no change.

The migration keeps the existing database: **do not drop and rebuild it.**

## 1. Preflight

- Configure canonical environment keys before starting Chat (`docs/ENV.md`).
- Set `GATEWAY_TIMEOUT` in milliseconds; the old `COMMUNICATION_GATEWAY_TIMEOUT` value was in seconds.
- Set `VALKEY_URL` with a `valkey://` or `valkeys://` scheme.
- Take a backup: `pg_dump -Fc -t conversations -t conversation_participants -t messages -t read_states chat > chat-$(date +%F).dump`.

## 2. Register the preserved Alembic history

The first Prisma migration is the existing Python schema and must **not** be
executed against a database that already has it:

```bash
pnpm exec prisma migrate resolve --applied 20260101000000_chat_baseline
```

## 3. Apply the additive tenant scope

The second migration adds `tenant_id` and backfills it. It refuses to run unless
the target tenant is provided:

```bash
psql "$DATABASE_URL" -c "SET chat.default_tenant_id = '<tenant-uuid>';"
```

Because `SET` is session scoped, run the migration in the same session or set the
parameter for the role before applying:

```bash
PGOPTIONS="-c chat.default_tenant_id=<tenant-uuid>" pnpm exec prisma migrate deploy
```

The migration is additive: no table or column is dropped and no conversation data is
removed. Existing rows receive the configured tenant id. It also adds the per-tenant unique constraints
(`[tenantId, participantPairKey]`, `[tenantId, externalAddress]`,
`[tenantId, providerMessageId]`) and reports duplicates instead of failing
silently. A non-empty report means two tenants share a participant pair or an
address and the data must be resolved before the new instance starts.

## 4. Start the new instance

```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm run build
NODE_ENV=production node dist/main
```

The container entrypoint runs `prisma generate && prisma migrate deploy && node
dist/main.js`.

## 5. Verify

```bash
curl -fsS "$CHAT_URL/health/liveness"
curl -fsS "$CHAT_URL/health/readiness"     # every indicator must be "up"
```

Then check, against the Gateway, which is the only consumer of the internal API:

- `GET /api/v1/internal/conversations/{id}/participants/{userId}` answers `204`
  for a member, `403` for a non-member and `404` for an unknown id;
- `POST /api/v1/internal/inbound-message` with a known provider message id stores
  nothing new and answers `200` with `duplicate: true`;
- `POST /api/v1/internal/delivery-status` accepts a forward transition and refuses
  a backward one.

Check that the outbox drains:

```sql
SELECT count(*) FROM analytics_outbox
 WHERE published_at IS NULL AND dead_lettered_at IS NULL;
```

## 6. Rollback

The old image can be started again: the second migration is additive, so the
Python implementation keeps working. It ignores the added `tenant_id` columns and
their defaults.

Rolling **back the migration** is not required and must not be done while the new
instance has written tenant-scoped rows; a re-run of the same migration is
idempotent, but dropping the column would lose the tenant scope.
