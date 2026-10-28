/**
 * @license GPL-3.0-or-later
 * Copyright (C) 2025 Caleb Gyamfi - Omnixys Technologies
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { Prisma, PrismaClient } from '../../prisma/generated/client.js';
import type { Conversation } from '../models/entities/conversation.model.js';
import { type Message } from '../models/entities/message.model.js';
import type { ReadState } from '../models/entities/message.model.js';
import type {
  ChannelType,
  ConversationType,
} from '../models/enums/conversation.enums.js';
import {
  isChannelType,
  isConversationType,
} from '../models/enums/conversation.enums.js';
import { ChannelType as Channel } from '../models/enums/conversation.enums.js';
import {
  DeliveryStatus,
  isDeliveryStatus,
  isMessageContentType,
  type MessageContentType,
} from '../models/enums/message.enums.js';
import { MessageContentType as Content } from '../models/enums/message.enums.js';
import type { ConversationRepository } from '../ports/conversation.repository.port.js';
import type {
  MessagePageRequest,
  MessageRepository,
  ReadStateRepository,
} from '../ports/message.repository.port.js';
import { randomUUID } from 'node:crypto';

/** Minimal surface used by the repositories; satisfied by the client and by a tx. */
export type ChatDatabase = PrismaClient | Prisma.TransactionClient;

interface ConversationRow {
  id: string;
  tenantId: string;
  type: string;
  participantPairKey: string;
  channel: string;
  externalAddress: string | null;
  externalDisplayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageRow {
  id: string;
  tenantId: string;
  conversationId: string;
  senderId: string;
  body: string;
  contentType: string;
  channel: string;
  deliveryStatus: string;
  providerMessageId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

interface ReadStateRow {
  id: string;
  tenantId: string;
  conversationId: string;
  userId: string;
  lastReadAt: Date | null;
  lastReadMessageId: string | null;
}

/** Row shape returned by the raw monotonic upsert, which selects mapped columns. */
interface ReadStateRawRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  user_id: string;
  last_read_at: Date | null;
  last_read_message_id: string | null;
}

/**
 * Unknown enum strings coming out of the database are mapped to a safe default
 * instead of being passed through. A row written by a newer service version must
 * not make this service crash on read.
 */
function toChannelType(value: string): ChannelType {
  return isChannelType(value) ? value : Channel.IN_APP;
}

function toConversationType(value: string): ConversationType {
  return isConversationType(value) ? value : 'DIRECT';
}

function toMessageContentType(value: string): MessageContentType {
  return isMessageContentType(value) ? value : Content.TEXT;
}

function toDeliveryStatus(value: string): DeliveryStatus {
  return isDeliveryStatus(value) ? value : DeliveryStatus.UNKNOWN;
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    senderId: row.senderId,
    body: row.body,
    contentType: toMessageContentType(row.contentType),
    channel: toChannelType(row.channel),
    deliveryStatus: toDeliveryStatus(row.deliveryStatus),
    providerMessageId: row.providerMessageId,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
  };
}

export function toReadState(row: ReadStateRow): ReadState {
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    userId: row.userId,
    lastReadAt: row.lastReadAt,
    lastReadMessageId: row.lastReadMessageId,
  };
}

/**
 * The conversation projection is assembled from the row plus its participants and
 * last message. Keeping that assembly here means the domain model stays free of
 * persistence concerns.
 */
export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly db: ChatDatabase) {}

  async findById(
    tenantId: string,
    conversationId: string,
  ): Promise<Conversation | null> {
    const row = await this.db.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    return row === null ? null : this.project(row);
  }

  async findByIdAnyTenant(
    conversationId: string,
  ): Promise<Conversation | null> {
    const row = await this.db.conversation.findUnique({
      where: { id: conversationId },
    });
    return row === null ? null : this.project(row);
  }

  async findByParticipantPairKey(
    tenantId: string,
    participantPairKey: string,
  ): Promise<Conversation | null> {
    const row = await this.db.conversation.findFirst({
      where: { tenantId, participantPairKey },
    });
    return row === null ? null : this.project(row);
  }

  async findByUserId(
    tenantId: string,
    userId: string,
  ): Promise<Conversation[]> {
    const rows = await this.db.conversation.findMany({
      where: {
        tenantId,
        participants: { some: { tenantId, userId } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return Promise.all(rows.map((row) => this.project(row)));
  }

  async findByExternalAddress(
    tenantId: string,
    externalAddress: string,
  ): Promise<Conversation | null> {
    const row = await this.db.conversation.findFirst({
      where: { tenantId, externalAddress },
    });
    return row === null ? null : this.project(row);
  }

  async findByExternalAddressAnyTenant(
    externalAddress: string,
  ): Promise<readonly Conversation[]> {
    const rows = await this.db.conversation.findMany({
      where: { externalAddress },
      take: 2,
    });
    return Promise.all(rows.map((row) => this.project(row)));
  }

  async save(
    tenantId: string,
    conversation: Conversation,
  ): Promise<Conversation> {
    const row = await this.db.conversation.upsert({
      where: { id: conversation.id },
      create: {
        id: conversation.id,
        tenantId,
        type: conversation.type,
        participantPairKey: conversation.participantPairKey,
        channel: conversation.channel,
        externalAddress: conversation.externalAddress,
        externalDisplayName: conversation.externalDisplayName,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      update: {
        participantPairKey: conversation.participantPairKey,
        channel: conversation.channel,
        externalAddress: conversation.externalAddress,
        externalDisplayName: conversation.externalDisplayName,
        type: conversation.type,
        updatedAt: conversation.updatedAt,
      },
    });
    return this.project(
      row,
      conversation.lastMessage,
      conversation.lastMessageAt,
    );
  }

  async addParticipant(
    tenantId: string,
    conversationId: string,
    userId: string,
  ): Promise<void> {
    await this.db.conversationParticipant.upsert({
      where: {
        uq_conversation_participant: { conversationId, userId },
      },
      create: { tenantId, conversationId, userId },
      update: {},
    });
  }

  async isParticipant(
    tenantId: string,
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const row = await this.db.conversationParticipant.findFirst({
      where: { tenantId, conversationId, userId },
      select: { id: true },
    });
    return row !== null;
  }

  async getParticipantIds(
    tenantId: string,
    conversationId: string,
  ): Promise<readonly string[]> {
    const rows = await this.db.conversationParticipant.findMany({
      where: { tenantId, conversationId },
      select: { userId: true },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((row) => row.userId);
  }

  async touch(
    tenantId: string,
    conversationId: string,
    at: Date,
  ): Promise<void> {
    await this.db.conversation.updateMany({
      where: { id: conversationId, tenantId },
      data: { updatedAt: at },
    });
  }

  private async project(
    row: ConversationRow,
    lastMessageOverride?: string | null,
    lastMessageAtOverride?: Date | null,
  ): Promise<Conversation> {
    const [participants, lastMessage] = await Promise.all([
      this.db.conversationParticipant.findMany({
        where: { tenantId: row.tenantId, conversationId: row.id },
        select: { userId: true },
        orderBy: { joinedAt: 'asc' },
      }),
      lastMessageOverride !== undefined
        ? Promise.resolve(null)
        : this.db.message.findFirst({
            where: {
              tenantId: row.tenantId,
              conversationId: row.id,
              deletedAt: null,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { body: true, createdAt: true },
          }),
    ]);

    return {
      id: row.id,
      tenantId: row.tenantId,
      type: toConversationType(row.type),
      participantPairKey: row.participantPairKey,
      channel: toChannelType(row.channel),
      externalAddress: row.externalAddress,
      externalDisplayName: row.externalDisplayName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      participantIds: participants.map((participant) => participant.userId),
      lastMessage:
        lastMessageOverride !== undefined
          ? lastMessageOverride
          : (lastMessage?.body ?? null),
      lastMessageAt:
        lastMessageAtOverride !== undefined
          ? lastMessageAtOverride
          : (lastMessage?.createdAt ?? null),
    };
  }
}

export class PrismaMessageRepository implements MessageRepository {
  constructor(private readonly db: ChatDatabase) {}

  async findByConversation(
    tenantId: string,
    conversationId: string,
    request: MessagePageRequest,
  ): Promise<Message[]> {
    const rows = await this.db.message.findMany({
      where: cursorWhere(tenantId, conversationId, request),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: request.limit,
    });
    return rows.map(toMessage);
  }

  async save(tenantId: string, message: Message): Promise<Message> {
    const row = await this.db.message.create({
      data: {
        id: message.id,
        tenantId,
        conversationId: message.conversationId,
        senderId: message.senderId,
        body: message.body,
        contentType: message.contentType,
        channel: message.channel,
        deliveryStatus: message.deliveryStatus,
        providerMessageId: message.providerMessageId,
        createdAt: message.createdAt,
        editedAt: message.editedAt,
        deletedAt: message.deletedAt,
      },
    });
    return toMessage(row);
  }

  async findById(tenantId: string, messageId: string): Promise<Message | null> {
    const row = await this.db.message.findFirst({
      where: { id: messageId, tenantId },
    });
    return row === null ? null : toMessage(row);
  }

  async findByIdAnyTenant(messageId: string): Promise<Message | null> {
    const row = await this.db.message.findUnique({ where: { id: messageId } });
    return row === null ? null : toMessage(row);
  }

  async findByProviderMessageIdAnyTenant(
    providerMessageId: string,
  ): Promise<readonly Message[]> {
    const rows = await this.db.message.findMany({
      where: { providerMessageId },
      take: 2,
    });
    return rows.map(toMessage);
  }

  async findByIdInConversation(
    tenantId: string,
    conversationId: string,
    messageId: string,
  ): Promise<boolean> {
    const row = await this.db.message.findFirst({
      where: { id: messageId, tenantId, conversationId },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Unread means "received from somebody else and newer than my cursor". The
   * caller's own messages never count, and without a cursor every message in the
   * conversation does.
   */
  async countUnread(
    tenantId: string,
    conversationId: string,
    userId: string,
    lastReadAt: Date | null,
  ): Promise<number> {
    return this.db.message.count({
      where: {
        tenantId,
        conversationId,
        deletedAt: null,
        NOT: { senderId: userId },
        ...(lastReadAt === null ? {} : { createdAt: { gt: lastReadAt } }),
      },
    });
  }

  async getLastMessage(
    tenantId: string,
    conversationId: string,
  ): Promise<Message | null> {
    const row = await this.db.message.findFirst({
      where: { tenantId, conversationId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row === null ? null : toMessage(row);
  }

  async updateDeliveryStatus(
    tenantId: string,
    messageId: string,
    deliveryStatus: DeliveryStatus,
    providerMessageId?: string | null,
  ): Promise<Message | null> {
    const row = await this.db.message.updateMany({
      where: { id: messageId, tenantId },
      data: {
        deliveryStatus,
        ...(providerMessageId === undefined ? {} : { providerMessageId }),
      },
    });
    if (row.count === 0) {
      return null;
    }
    const updated = await this.db.message.findFirst({
      where: { id: messageId, tenantId },
    });
    return updated === null ? null : toMessage(updated);
  }
}

export class PrismaReadStateRepository implements ReadStateRepository {
  constructor(private readonly db: ChatDatabase) {}

  async find(
    tenantId: string,
    conversationId: string,
    userId: string,
  ): Promise<ReadState | null> {
    const row = await this.db.readState.findUnique({
      where: {
        uq_read_state_conversation_user: { conversationId, userId },
      },
    });
    return row === null ? null : toReadState({ ...row, tenantId });
  }

  /**
   * Monotonic upsert in a single statement.
   *
   * A read-then-write would let a slow client overwrite a newer cursor that a
   * second device committed in between. The conditional `ON CONFLICT DO UPDATE`
   * makes the write itself conditional, so a stale caller cannot move the cursor
   * backwards and the tie-break on the message id keeps the result deterministic.
   */
  async upsert(
    tenantId: string,
    state: Omit<ReadState, 'id' | 'tenantId'>,
  ): Promise<ReadState> {
    if (state.lastReadAt === null) {
      const existing = await this.find(
        tenantId,
        state.conversationId,
        state.userId,
      );
      if (existing === null) {
        throw new Error('read_state_without_cursor_cannot_be_created');
      }
      return existing;
    }

    const rows = await this.db.$queryRaw<ReadStateRawRow[]>`
      INSERT INTO read_states (
        id, tenant_id, conversation_id, user_id, last_read_at, last_read_message_id
      )
      VALUES (
        ${randomUUID()}::varchar, ${tenantId}::varchar, ${state.conversationId}::varchar,
        ${state.userId}::varchar, ${state.lastReadAt}::timestamp,
        ${state.lastReadMessageId}::varchar
      )
      ON CONFLICT (conversation_id, user_id)
      DO UPDATE SET
        last_read_at = EXCLUDED.last_read_at,
        last_read_message_id = EXCLUDED.last_read_message_id
      WHERE read_states.last_read_at IS NULL
         OR EXCLUDED.last_read_at > read_states.last_read_at
         OR (
           EXCLUDED.last_read_at = read_states.last_read_at
           AND COALESCE(EXCLUDED.last_read_message_id, '') > COALESCE(read_states.last_read_message_id, '')
         )
      RETURNING
        id, tenant_id, conversation_id, user_id, last_read_at, last_read_message_id
    `;

    const row = rows[0];
    if (row === undefined) {
      // The `WHERE` guard rejected the update, so the stored cursor is the newer one.
      const current = await this.find(
        tenantId,
        state.conversationId,
        state.userId,
      );
      if (current === null) {
        throw new Error('read_state_conflict_without_row');
      }
      return current;
    }
    return toReadState({
      id: row.id,
      tenantId: row.tenant_id,
      conversationId: row.conversation_id,
      userId: row.user_id,
      lastReadAt: row.last_read_at,
      lastReadMessageId: row.last_read_message_id,
    });
  }
}

function cursorWhere(
  tenantId: string,
  conversationId: string,
  request: MessagePageRequest,
): Prisma.MessageWhereInput {
  const base: Prisma.MessageWhereInput = {
    tenantId,
    conversationId,
    deletedAt: null,
  };
  if (request.cursor === null) {
    return base;
  }
  const { createdAt, id } = request.cursor;
  if (id === undefined || id === '') {
    return { ...base, createdAt: { lt: createdAt } };
  }
  return {
    ...base,
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
  };
}
