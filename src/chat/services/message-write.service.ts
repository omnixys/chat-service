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

import {
  conversationNotFound,
  deliveryStatusTransitionInvalid,
  messageInputInvalid,
} from '../errors/chat.errors.js';
import { type Message } from '../models/entities/message.model.js';
import {
  canTransitionDeliveryStatus,
  DeliveryStatus,
  isDeliveryStatus,
  isMessageContentType,
  type MessageContentType,
} from '../models/enums/message.enums.js';
import type { MessageRepository } from '../ports/message.repository.port.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port.js';
import { Inject, Injectable } from '@nestjs/common';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';
import { randomUUID } from 'node:crypto';

export const MESSAGE_SENT_EVENT = 'chat.message.sent.v1';
export const MESSAGE_DELIVERY_STATUS_CHANGED_EVENT = 'chat.message.delivery-status-changed.v1';

export interface SendMessageCommand {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly body: string;
  readonly contentType?: string | null;
  readonly correlationId?: string | undefined;
}

@Injectable()
export class MessageWriteService {
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(OmnixysLogger) logger: OmnixysLogger,
  ) {
    this.logger = logger.log(this.constructor.name);
  }

  /**
   * Persists an outbound message as `PENDING`. The delivery itself is a separate
   * step so that a channel timeout can never roll back the stored message.
   */
  async send(command: SendMessageCommand): Promise<{
    message: Message;
    tenantId: string;
  }> {
    const { tenantId } = command;
    const body = normalizeBody(command.body);
    const contentType = normalizeContentType(command.contentType);

    return this.unitOfWork.transaction(
      async ({ conversationRepository, messageRepository, analytics }) => {
        // Membership is checked before the conversation is loaded, so sending to a
        // conversation of another tenant or one the caller does not belong to
        // produces the same error as sending to an id that does not exist.
        const isParticipant = await conversationRepository.isParticipant(
          tenantId,
          command.conversationId,
          command.senderId,
        );
        if (!isParticipant) {
          throw conversationNotFound(command.conversationId);
        }
        const conversation = await conversationRepository.findById(
          tenantId,
          command.conversationId,
        );
        if (conversation === null) {
          throw conversationNotFound(command.conversationId);
        }

        const now = new Date();
        const message: Message = {
          id: randomUUID(),
          tenantId,
          conversationId: command.conversationId,
          senderId: command.senderId,
          body,
          contentType,
          channel: conversation.channel,
          deliveryStatus: DeliveryStatus.PENDING,
          providerMessageId: null,
          createdAt: now,
          editedAt: null,
          deletedAt: null,
        };

        const saved = await messageRepository.save(tenantId, message);
        await conversationRepository.touch(tenantId, saved.conversationId, now);
        await conversationRepository.save(tenantId, {
          ...conversation,
          lastMessage: saved.body,
          lastMessageAt: now,
          updatedAt: now,
        });

        await analytics.enqueue({
          topic: MESSAGE_SENT_EVENT,
          eventName: 'message.sent',
          aggregateId: saved.id,
          aggregateType: 'chat.message',
          subjectId: command.senderId,
          tenantId,
          correlationId: command.correlationId,
          actorId: command.senderId,
          properties: {
            conversationId: saved.conversationId,
            channel: saved.channel,
            contentType: saved.contentType,
            bodyLength: saved.body.length,
          },
        });

        this.logger.info('message_sent', {
          messageId: saved.id,
          conversationId: saved.conversationId,
          channel: saved.channel,
        });
        return { message: saved, tenantId };
      },
    );
  }

  /**
   * Applies a provider delivery status update. Transitions that the delivery
   * lifecycle does not allow are rejected with `409` instead of silently
   * downgrading a confirmed delivery, and repeated deliveries of the same status
   * stay idempotent.
   */
  async applyDeliveryStatus(options: {
    messageId?: string | null;
    providerMessageId?: string | null;
    deliveryStatus: string;
    correlationId?: string | undefined;
  }): Promise<Message> {
    const target = normalizeDeliveryStatus(options.deliveryStatus);
    const hasMessageId = options.messageId !== null && options.messageId !== undefined;
    const hasProviderId =
      options.providerMessageId !== null && options.providerMessageId !== undefined;
    if (!hasMessageId && !hasProviderId) {
      throw messageInputInvalid('delivery-status-requires-message-reference');
    }

    return this.unitOfWork.transaction(async ({ messageRepository, analytics }) => {
      const current = hasMessageId
        ? await messageRepository.findByIdAnyTenant(options.messageId as string)
        : await resolveProviderMessage(messageRepository, options.providerMessageId as string);
      if (current === null) {
        throw messageInputInvalid('delivery-status-unknown-message');
      }

      const providerMessageId = hasProviderId ? (options.providerMessageId as string) : null;

      if (current.deliveryStatus === target) {
        this.logger.debug('delivery_status_unchanged', {
          messageId: current.id,
          status: target,
        });
        return current;
      }
      if (!canTransitionDeliveryStatus(current.deliveryStatus, target)) {
        throw deliveryStatusTransitionInvalid(current.id, current.deliveryStatus, target);
      }

      const updated = await messageRepository.updateDeliveryStatus(
        current.tenantId,
        current.id,
        target,
        providerMessageId,
      );
      if (updated === null) {
        throw messageInputInvalid('delivery-status-update-lost-race');
      }

      await analytics.enqueue({
        topic: MESSAGE_DELIVERY_STATUS_CHANGED_EVENT,
        eventName: 'message.delivery-status-changed',
        aggregateId: updated.id,
        aggregateType: 'chat.message',
        subjectId: updated.senderId,
        tenantId: updated.tenantId,
        correlationId: options.correlationId,
        actorId: updated.senderId,
        properties: {
          conversationId: updated.conversationId,
          channel: updated.channel,
          from: current.deliveryStatus,
          to: target,
        },
      });

      this.logger.info('delivery_status_changed', {
        messageId: updated.id,
        from: current.deliveryStatus,
        to: target,
      });
      return updated;
    });
  }
}

function normalizeBody(body: string): string {
  if (typeof body !== 'string' || body.trim() === '') {
    throw messageInputInvalid('message-body-empty');
  }
  return body;
}

/**
 * Resolves a message by provider id across tenants. A provider id that exists in
 * more than one tenant is refused: applying a delivery status to an arbitrary row
 * would mark an unrelated tenant's message as delivered.
 */
async function resolveProviderMessage(
  repository: MessageRepository,
  providerMessageId: string,
): Promise<Message | null> {
  const matches = await repository.findByProviderMessageIdAnyTenant(providerMessageId);
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw messageInputInvalid('provider-message-id-ambiguous', {
      providerMessageId,
      matchCount: matches.length,
    });
  }
  return matches[0] as Message;
}

function normalizeContentType(contentType: string | null | undefined): MessageContentType {
  if (contentType === null || contentType === undefined) {
    return 'TEXT';
  }
  if (!isMessageContentType(contentType)) {
    throw messageInputInvalid('unsupported-content-type', { contentType });
  }
  return contentType;
}

function normalizeDeliveryStatus(value: string): DeliveryStatus {
  if (!isDeliveryStatus(value)) {
    throw messageInputInvalid('unsupported-delivery-status', {
      deliveryStatus: value,
    });
  }
  return value;
}
