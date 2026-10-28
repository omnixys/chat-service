-- Baseline of the pre-existing Python/Alembic schema.
--
-- This migration is NOT applied automatically. Register it against an existing
-- database with:
--
--   pnpm exec prisma migrate resolve --applied 20260101000000_chat_baseline
--
-- See docs/CUTOVER.md for the full operator procedure.

CREATE TABLE "conversations" (
    "id" VARCHAR(36) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'DIRECT',
    "participant_pair_key" VARCHAR(500) NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'IN_APP',
    "external_address" VARCHAR(32),
    "external_display_name" VARCHAR(255),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversations_participant_pair_key_key" ON "conversations"("participant_pair_key");
CREATE UNIQUE INDEX "conversations_external_address_key" ON "conversations"("external_address");

CREATE TABLE "conversation_participants" (
    "id" VARCHAR(36) NOT NULL,
    "conversation_id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "joined_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

CREATE TABLE "messages" (
    "id" VARCHAR(36) NOT NULL,
    "conversation_id" VARCHAR(36) NOT NULL,
    "sender_id" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "content_type" VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    "channel" VARCHAR(20) NOT NULL DEFAULT 'IN_APP',
    "delivery_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "provider_message_id" VARCHAR(255),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMP,
    "deleted_at" TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "messages_provider_message_id_key" ON "messages"("provider_message_id");

CREATE TABLE "read_states" (
    "id" VARCHAR(36) NOT NULL,
    "conversation_id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "last_read_at" TIMESTAMP,
    "last_read_message_id" VARCHAR(36),

    CONSTRAINT "read_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_outbox" (
    "id" VARCHAR(36) NOT NULL,
    "tenant_id" VARCHAR(36) NOT NULL,
    "topic" VARCHAR(200) NOT NULL,
    "payload" JSON NOT NULL,
    "correlation_id" VARCHAR(255),
    "actor_id" VARCHAR(255),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "locked_at" TIMESTAMPTZ,
    "locked_by" VARCHAR(36),
    "published_at" TIMESTAMPTZ,
    "dead_lettered_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "analytics_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analytics_outbox_tenant_id_idx" ON "analytics_outbox"("tenant_id");
CREATE INDEX "analytics_outbox_ready_idx" ON "analytics_outbox"("published_at", "dead_lettered_at", "next_attempt_at");

-- Prisma relation constraints.
ALTER TABLE "conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "read_states"
    ADD CONSTRAINT "read_states_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "read_states"
    ADD CONSTRAINT "read_states_last_read_message_id_fkey"
    FOREIGN KEY ("last_read_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Named unique constraints carried over from Alembic.
ALTER TABLE "conversation_participants"
    ADD CONSTRAINT "uq_conversation_participant" UNIQUE ("conversation_id", "user_id");

ALTER TABLE "read_states"
    ADD CONSTRAINT "uq_read_state_conversation_user" UNIQUE ("conversation_id", "user_id");
