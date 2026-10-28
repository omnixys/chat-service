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

import { messageInputInvalid } from '../errors/chat.errors.js';
import { isUniqueViolation } from '../errors/prisma.error.js';
import {
  buildDirectParticipantKey,
  EmptyUserIdError,
  InvalidPhoneNumberError,
  normalizeE164,
  SameUserConversationError,
  type Conversation,
} from '../models/entities/conversation.model.js';
import { ChannelType, ConversationType } from '../models/enums/conversation.enums.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
  type UnitOfWorkContext,
} from '../ports/unit-of-work.port.js';
import { Inject, Injectable } from '@nestjs/common';
import { FrameworkException } from '@omnixys/contracts-ts';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';
import { randomUUID } from 'node:crypto';

export const CONVERSATION_CREATED_EVENT = 'chat.conversation.created.v1';

const DIRECT_CONVERSATION_TYPES: readonly ConversationType[] = [
  ConversationType.DIRECT,
  ConversationType.SUPPORT,
];

@Injectable()
export class ConversationWriteService {
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(OmnixysLogger) logger: OmnixysLogger,
  ) {
    this.logger = logger.log(this.constructor.name);
  }

  /**
   * Returns the existing direct/support conversation between the two users or
   * creates it. Creation is idempotent: the unique participant key plus the
   * `P2002` recovery make concurrent callers converge on one row.
   */
  async createDirectConversation(
    tenantId: string,
    actorId: string,
    participantUserId: string,
    conversationType: ConversationType = ConversationType.DIRECT,
  ): Promise<Conversation> {
    if (!DIRECT_CONVERSATION_TYPES.includes(conversationType)) {
      throw messageInputInvalid('conversation-type-not-in-app', {
        conversationType,
      });
    }

    let participantPairKey: string;
    try {
      participantPairKey = buildDirectParticipantKey(actorId, participantUserId);
    } catch (cause) {
      throw directParticipantKeyError(cause);
    }

    // Support conversations are a separate namespace but share the same shape.
    const lookupKey =
      conversationType === ConversationType.DIRECT
        ? participantPairKey
        : `support:${participantPairKey}`;

    return this.createUnique({
      tenantId,
      actorId,
      lookupKey,
      build: (now) => ({
        id: randomUUID(),
        tenantId,
        type: conversationType,
        participantPairKey: lookupKey,
        channel: ChannelType.IN_APP,
        externalAddress: null,
        externalDisplayName: null,
        createdAt: now,
        updatedAt: now,
        participantIds: [actorId, participantUserId],
        lastMessage: null,
        lastMessageAt: null,
      }),
    });
  }

  /**
   * Creates the one-to-one conversation that owns a WhatsApp address. The address
   * is globally unique per tenant; a second user cannot take over an address that
   * already belongs to somebody else.
   */
  async createWhatsappConversation(
    tenantId: string,
    ownerUserId: string,
    phoneNumber: string,
    displayName: string | null,
  ): Promise<Conversation> {
    if (ownerUserId === '') {
      throw messageInputInvalid('owner-user-id-missing');
    }

    let externalAddress: string;
    try {
      externalAddress = normalizeE164(phoneNumber);
    } catch (cause) {
      throw invalidPhoneNumberError(cause);
    }

    const lookupKey = `whatsapp:${externalAddress}`;

    return this.createUnique({
      tenantId,
      actorId: ownerUserId,
      lookupKey,
      lookup: ({ conversationRepository }) =>
        conversationRepository.findByExternalAddress(tenantId, externalAddress),
      build: (now) => ({
        id: randomUUID(),
        tenantId,
        type: ConversationType.DIRECT,
        participantPairKey: lookupKey,
        channel: ChannelType.WHATSAPP,
        externalAddress,
        externalDisplayName: normalizeDisplayName(displayName),
        createdAt: now,
        updatedAt: now,
        participantIds: [ownerUserId],
        lastMessage: null,
        lastMessageAt: null,
      }),
      assertOwner: async (existing) => {
        const isOwner = await this.isParticipant(tenantId, existing.id, ownerUserId);
        if (!isOwner) {
          throw messageInputInvalid('whatsapp-address-already-claimed', {
            conversationId: existing.id,
          });
        }
      },
    });
  }

  /**
   * Shared idempotent create: pre-check, insert, and recover from the unique
   * constraint race. The recovery re-reads inside a fresh transaction because the
   * failed one has already been rolled back.
   */
  private async createUnique(options: {
    tenantId: string;
    actorId: string;
    lookupKey: string;
    build: (now: Date) => Conversation;
    lookup?: (context: UnitOfWorkContext) => Promise<Conversation | null>;
    assertOwner?: (existing: Conversation) => Promise<void>;
  }): Promise<Conversation> {
    const { tenantId, actorId, lookupKey, build, assertOwner } = options;
    const lookup =
      options.lookup ??
      ((context: UnitOfWorkContext) =>
        context.conversationRepository.findByParticipantPairKey(tenantId, lookupKey));

    try {
      return await this.unitOfWork.transaction(async (context) => {
        const existing = await lookup(context);
        if (existing !== null) {
          await assertOwner?.(existing);
          this.logger.debug('conversation_reused', {
            conversationId: existing.id,
            lookupKey,
          });
          return existing;
        }

        const conversation = build(new Date());
        const saved = await context.conversationRepository.save(tenantId, conversation);
        for (const participantId of conversation.participantIds) {
          await context.conversationRepository.addParticipant(tenantId, saved.id, participantId);
        }

        // `save` projects participants from the database at insert time, before the
        // participant rows exist, so overlay the participants we just persisted onto
        // the returned conversation. Re-reading inside the transaction would return
        // the same list but costs an extra round trip for no additional truth.
        const created = { ...saved, participantIds: conversation.participantIds };

        await context.analytics.enqueue({
          topic: CONVERSATION_CREATED_EVENT,
          eventName: 'conversation.created',
          aggregateId: created.id,
          aggregateType: 'chat.conversation',
          subjectId: created.participantIds[0],
          actorId,
          tenantId,
          properties: {
            type: created.type,
            channel: created.channel,
            participantCount: created.participantIds.length,
          },
        });

        this.logger.info('conversation_created', {
          conversationId: created.id,
          type: created.type,
          channel: created.channel,
        });
        return created;
      });
    } catch (cause) {
      if (!isUniqueViolation(cause)) {
        throw cause;
      }
      this.logger.info('conversation_create_race_recovered', { lookupKey });
      const winner = await this.unitOfWork.transaction((context) => lookup(context));
      if (winner === null) {
        throw cause;
      }
      await assertOwner?.(winner);
      return winner;
    }
  }

  private async isParticipant(
    tenantId: string,
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    return this.unitOfWork.transaction(({ conversationRepository }: UnitOfWorkContext) =>
      conversationRepository.isParticipant(tenantId, conversationId, userId),
    );
  }
}

function normalizeDisplayName(displayName: string | null): string | null {
  if (displayName === null || displayName === undefined) {
    return null;
  }
  const trimmed = displayName.trim();
  return trimmed === '' ? null : trimmed;
}

function directParticipantKeyError(cause: unknown): FrameworkException {
  if (cause instanceof SameUserConversationError) {
    return messageInputInvalid('direct-conversation-with-self', {
      userId: cause.userId,
    });
  }
  if (cause instanceof EmptyUserIdError) {
    return messageInputInvalid('participant-user-id-missing');
  }
  throw cause;
}

function invalidPhoneNumberError(cause: unknown): FrameworkException {
  if (cause instanceof InvalidPhoneNumberError) {
    return messageInputInvalid('phone-number-not-e164');
  }
  throw cause;
}
