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

import { ConversationType } from '../models/enums/conversation.enums.js';
import {
  optionalContentType,
  optionalConversationType,
  optionalDate,
  optionalDisplayName,
  requireBody,
  requireConversationId,
  requireParticipantUserId,
  requirePhoneNumber,
  requireUuid,
} from '../models/inputs/graphql-args.js';
import { toConversationModel, toMessageModel } from '../models/mappers/chat.mapper.js';
import type { ConversationModel, MessageModel } from '../models/payloads/conversation.model.js';
import { ConversationWriteService } from './conversation-write.service.js';
import { MessageDispatcher } from './message-dispatcher.service.js';
import { MessageWriteService } from './message-write.service.js';
import { ReadStateService } from './read-state.service.js';
import { Inject } from '@nestjs/common';

import { Injectable } from '@nestjs/common';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';

/**
 * Write-side GraphQL adapter.
 *
 * Sending is split into "store" and "deliver": the message is committed first and
 * the channel adapter runs afterwards, so a gateway timeout can never lose a
 * message the sender already saw accepted.
 */
@Injectable()
export class GraphqlChatWriteService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly conversations: ConversationWriteService,
    private readonly messages: MessageWriteService,
    private readonly dispatcher: MessageDispatcher,
    private readonly readStates: ReadStateService,
    @Inject(OmnixysLogger) logger: OmnixysLogger,
  ) {
    this.logger = logger.log(this.constructor.name);
  }

  async createInAppConversation(
    tenantId: string,
    actorId: string,
    participantUserId: unknown,
    conversationType?: unknown,
  ): Promise<ConversationModel> {
    const conversation = await this.conversations.createDirectConversation(
      tenantId,
      actorId,
      requireParticipantUserId(participantUserId),
      optionalConversationType(conversationType) ?? ConversationType.DIRECT,
    );
    return toConversationModel(conversation);
  }

  async createWhatsappConversation(
    tenantId: string,
    actorId: string,
    phoneNumber: unknown,
    displayName?: unknown,
  ): Promise<ConversationModel> {
    const conversation = await this.conversations.createWhatsappConversation(
      tenantId,
      actorId,
      requirePhoneNumber(phoneNumber),
      optionalDisplayName(displayName),
    );
    return toConversationModel(conversation);
  }

  async sendMessage(
    tenantId: string,
    senderId: string,
    conversationId: unknown,
    body: unknown,
    contentType?: unknown,
    correlationId?: string,
  ): Promise<MessageModel> {
    const { message } = await this.messages.send({
      tenantId,
      conversationId: requireConversationId(conversationId),
      senderId,
      body: requireBody(body),
      contentType: optionalContentType(contentType),
      correlationId,
    });

    try {
      const dispatched = await this.dispatcher.dispatch(message.id, tenantId);
      return toMessageModel(dispatched.message);
    } catch (cause) {
      // The message is stored. The dispatcher records FAILED on a channel error, so
      // reaching this point means the post-commit step itself failed; the stored
      // message stays PENDING and the outbox publisher retries nothing here.
      this.logger.error('message_dispatch_failed', {
        messageId: message.id,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return toMessageModel(message);
    }
  }

  /**
   * The contract answers `Boolean`, so the cursor is advanced and the resulting
   * unread count is logged instead of being returned.
   *
   * The contract only requires `conversationId`; a call without a cursor marks
   * everything as read up to now. The cursor arguments are additive and let a
   * client acknowledge a known message id instead of the server clock.
   */
  async markRead(
    tenantId: string,
    userId: string,
    conversationId: unknown,
    lastReadAt?: unknown,
    lastReadMessageId?: unknown,
  ): Promise<boolean> {
    const { unreadCount } = await this.readStates.markRead(
      tenantId,
      requireConversationId(conversationId),
      userId,
      optionalDate(lastReadAt, 'lastReadAt') ?? new Date(),
      lastReadMessageId === null || lastReadMessageId === undefined
        ? null
        : requireUuid(lastReadMessageId, 'lastReadMessageId'),
    );
    this.logger.debug('conversation_marked_read', { conversationId, unreadCount });
    return true;
  }
}
