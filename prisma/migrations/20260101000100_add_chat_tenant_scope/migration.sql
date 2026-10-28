-- Additive tenant scope for the chat domain.
--
-- Every chat table becomes tenant scoped. Existing rows are backfilled with the
-- DEFAULT_TENANT_ID configured for the deployment before the NOT NULL constraint
-- is enforced, so the migration never drops or rewrites conversation data.
--
-- Precondition: the operator must have replaced the placeholder below with a real
-- tenant UUID. See docs/CUTOVER.md.

-- placeholder is substituted by the operator before applying
DO $$
BEGIN
    IF current_setting('chat.default_tenant_id', true) IS NULL THEN
        RAISE EXCEPTION
            'Set chat.default_tenant_id before applying this migration (see docs/CUTOVER.md)';
    END IF;
END
$$;

ALTER TABLE "conversations"
    ADD COLUMN "tenant_id" VARCHAR(36);

ALTER TABLE "conversation_participants"
    ADD COLUMN "tenant_id" VARCHAR(36);

ALTER TABLE "messages"
    ADD COLUMN "tenant_id" VARCHAR(36);

ALTER TABLE "read_states"
    ADD COLUMN "tenant_id" VARCHAR(36);

UPDATE "conversations"
    SET "tenant_id" = current_setting('chat.default_tenant_id')
    WHERE "tenant_id" IS NULL;

UPDATE "conversation_participants" AS "p"
    SET "tenant_id" = "c"."tenant_id"
    FROM "conversations" AS "c"
    WHERE "c"."id" = "p"."conversation_id" AND "p"."tenant_id" IS NULL;

UPDATE "messages" AS "m"
    SET "tenant_id" = "c"."tenant_id"
    FROM "conversations" AS "c"
    WHERE "c"."id" = "m"."conversation_id" AND "m"."tenant_id" IS NULL;

UPDATE "read_states" AS "r"
    SET "tenant_id" = "c"."tenant_id"
    FROM "conversations" AS "c"
    WHERE "c"."id" = "r"."conversation_id" AND "r"."tenant_id" IS NULL;

ALTER TABLE "conversations"
    ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "conversation_participants"
    ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "messages"
    ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "read_states"
    ALTER COLUMN "tenant_id" SET NOT NULL;

CREATE INDEX "conversations_tenant_id_idx" ON "conversations"("tenant_id");
CREATE INDEX "conversations_updated_at_idx" ON "conversations"("updated_at");
CREATE INDEX "conversations_participant_pair_key_idx" ON "conversations"("participant_pair_key");
CREATE INDEX "conversations_external_address_idx" ON "conversations"("external_address");
CREATE INDEX "conversation_participants_tenant_id_idx" ON "conversation_participants"("tenant_id");
CREATE INDEX "messages_tenant_id_idx" ON "messages"("tenant_id");
CREATE INDEX "messages_provider_message_id_idx" ON "messages"("provider_message_id");

-- Stable cursor pagination: (conversation_id, created_at, id).
CREATE INDEX "messages_conversation_id_created_at_id_idx"
    ON "messages"("conversation_id", "created_at", "id");
CREATE INDEX "read_states_tenant_id_idx" ON "read_states"("tenant_id");

-- Uniqueness becomes tenant scoped. The previous global constraints made two
-- tenants unable to hold the same participant pair, the same WhatsApp address or
-- the same provider message id. They are replaced by per-tenant constraints of
-- the same shape; the pre-flight check below guarantees the data already satisfies
-- them, so no row has to be rewritten.
DO $$
DECLARE
    conflicts text;
BEGIN
    SELECT string_agg(dupes, ', ') INTO conflicts
    FROM (
        SELECT 'conversations.participant_pair_key x' || count(*)::text AS dupes
        FROM (
            SELECT "tenant_id", "participant_pair_key"
            FROM "conversations"
            GROUP BY "tenant_id", "participant_pair_key"
            HAVING count(*) > 1
        ) AS duplicated_pairs
        HAVING count(*) > 0
        UNION ALL
        SELECT 'conversations.external_address x' || count(*)::text
        FROM (
            SELECT "tenant_id", "external_address"
            FROM "conversations"
            WHERE "external_address" IS NOT NULL
            GROUP BY "tenant_id", "external_address"
            HAVING count(*) > 1
        ) AS duplicated_addresses
        HAVING count(*) > 0
        UNION ALL
        SELECT 'messages.provider_message_id x' || count(*)::text
        FROM (
            SELECT "tenant_id", "provider_message_id"
            FROM "messages"
            WHERE "provider_message_id" IS NOT NULL
            GROUP BY "tenant_id", "provider_message_id"
            HAVING count(*) > 1
        ) AS duplicated_provider_ids
        HAVING count(*) > 0
    ) AS report;

    IF conflicts IS NOT NULL THEN
        RAISE EXCEPTION
            'Tenant scoped uniqueness pre-flight failed: %', conflicts;
    END IF;
END
$$;

ALTER TABLE "conversations"
    DROP CONSTRAINT IF EXISTS "conversations_participant_pair_key_key";
ALTER TABLE "conversations"
    DROP CONSTRAINT IF EXISTS "conversations_external_address_key";
ALTER TABLE "messages"
    DROP CONSTRAINT IF EXISTS "messages_provider_message_id_key";

ALTER TABLE "conversations"
    ADD CONSTRAINT "uq_conversation_tenant_pair_key"
        UNIQUE ("tenant_id", "participant_pair_key");
ALTER TABLE "conversations"
    ADD CONSTRAINT "uq_conversation_tenant_external_address"
        UNIQUE ("tenant_id", "external_address");
ALTER TABLE "messages"
    ADD CONSTRAINT "uq_message_tenant_provider_id"
        UNIQUE ("tenant_id", "provider_message_id");

-- The legacy conversation_settings table is retained for the Python service.
-- It is unmanaged by Prisma and may be retired in a separately reviewed migration.
