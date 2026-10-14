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

import { eventChannels, type MessageCreatedEvent } from '../../adapter/realtime/realtime.events.js';
import {
  REALTIME_PUBLISHER,
  type RealtimePublisher,
} from '../../adapter/realtime/realtime.port.js';
import {
  conversationNotFound,
  messageInputInvalid,
  unmatchedInboundMessage,
} from '../errors/chat.errors.js';
import { normalizeE164, type Conversation } from '../models/entities/conversation.model.js';
import { type Message } from '../models/entities/message.model.js';
import { ChannelType } from '../models/enums/conversation.enums.js';
import {
  DeliveryStatus,
  isMessageContentType,
  MessageContentType,
} from '../models/enums/message.enums.js';
import type { ConversationRepository } from '../ports/conversation.repository.port.js';
import type { MessageRepository } from '../ports/message.repository.port.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port.js';
import { Inject, Injectable } from '@nestjs/common';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';
import { randomUUID } from 'node:crypto';

export const MESSAGE_RECEIVED_EVENT = 'chat.message.received.v1';

export interface InboundMessagePayload {
  readonly messageId: string;
  readonly channel: string;
  readonly userId: string;
  readonly from: string;
  readonly body: string;
  readonly contentType: string;
  readonly conversationId: string | null;
}

export interface InboundMessageResult {
  readonly message: Message;
  readonly duplicate: boolean;
  readonly tenantId: string;
}

/**
 * Handles provider webhooks.
 *
 * Webhooks are retried by the gateway, so the provider message id is the
 * idempotency key: a repeat of a known id returns the stored message instead of
 * inserting a second row. The tenant is derived from the resolved conversation
 * because provider callbacks carry no tenant context of their own.
 */
@Injectable()
export class InboundMessageService {
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(OmnixysLogger) logger: OmnixysLogger,
  ) {
    this.logger = logger.log(this.constructor.name);
  }

  async handle(payload: InboundMessagePayload): Promise<InboundMessageResult> {
    const providerMessageId = requireText(payload.messageId, 'message_id');
    const channel = normalizeChannel(payload.channel);
    const contentType = normalizeContentType(payload.contentType);
    const body = requireText(payload.body, 'body');
    const externalAddress = normalizeOptionalAddress(payload.from);

    const { message, duplicate, tenantId, conversation } = await this.unitOfWork.transaction(
      async ({ conversationRepository, messageRepository, analytics }) => {
        const existing = await resolveProviderMessage(messageRepository, providerMessageId);
        if (existing !== null) {
          const owner = await conversationRepository.findByIdAnyTenant(existing.conversationId);
          return {
            message: existing,
            duplicate: true,
            tenantId: existing.tenantId,
            conversation: owner,
          };
        }

        const target = await resolveConversation(
          conversationRepository,
          payload.conversationId,
          externalAddress,
        );
        const now = new Date();
        const message: Message = {
          id: randomUUID(),
          tenantId: target.tenantId,
          conversationId: target.id,
          senderId: `whatsapp:${externalAddress ?? ''}`,
          body,
          contentType,
          channel,
          deliveryStatus: DeliveryStatus.DELIVERED,
          providerMessageId,
          createdAt: now,
          editedAt: null,
          deletedAt: null,
        };

        const saved = await messageRepository.save(target.tenantId, message);
        await conversationRepository.touch(target.tenantId, target.id, now);
        await conversationRepository.save(target.tenantId, {
          ...target,
          lastMessage: saved.body,
          lastMessageAt: now,
          updatedAt: now,
        });

        await analytics.enqueue({
          topic: MESSAGE_RECEIVED_EVENT,
          eventName: 'message.received',
          aggregateId: saved.id,
          aggregateType: 'chat.message',
          subjectId: saved.senderId,
          tenantId: target.tenantId,
          properties: {
            conversationId: target.id,
            channel,
            contentType,
            bodyLength: body.length,
          },
        });

        return {
          message: saved,
          duplicate: false,
          tenantId: target.tenantId,
          conversation: target,
        };
      },
    );

    if (!duplicate && conversation !== null) {
      await this.publish(message, conversation);
    }

    this.logger.info('inbound_message_processed', {
      messageId: message.id,
      conversationId: message.conversationId,
      channel: message.channel,
      duplicate,
    });

    return { message, duplicate, tenantId };
  }

  private async publish(message: Message, conversation: Conversation): Promise<void> {
    const event: MessageCreatedEvent = {
      messageId: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      body: message.body,
      contentType: message.contentType,
      channel: message.channel,
      deliveryStatus: message.deliveryStatus,
      createdAt: message.createdAt.toISOString(),
    };

    const participantIds = await this.unitOfWork
      .transaction(({ conversationRepository }) =>
        conversationRepository.getParticipantIds(conversation.tenantId, conversation.id),
      )
      .catch(() => conversation.participantIds);

    try {
      await Promise.all(
        eventChannels(conversation.id, participantIds).map((channel) =>
          this.realtime.publish(channel, event),
        ),
      );
    } catch (cause) {
      // The message is already committed. A realtime outage must not turn a
      // webhook retry into a duplicate row.
      this.logger.error('realtime_publish_error', {
        messageId: message.id,
        conversationId: message.conversationId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}

/**
 * Returns the message for a provider id, or `null` when the id is new. Refuses an
 * id that exists in more than one tenant instead of applying a delivery status to
 * an arbitrary row.
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

async function resolveConversation(
  repository: ConversationRepository,
  conversationId: string | null | undefined,
  externalAddress: string | null,
): Promise<Conversation> {
  if (conversationId !== null && conversationId !== undefined && conversationId !== '') {
    const conversation = await repository.findByIdAnyTenant(conversationId);
    if (conversation === null) {
      throw conversationNotFound(conversationId);
    }
    return conversation;
  }

  if (externalAddress !== null) {
    const owners = await findConversationByExternalAddress(repository, externalAddress);
    if (owners !== null) {
      return owners;
    }
  }

  throw unmatchedInboundMessage(
    externalAddress === null ? 'no-conversation-id-and-no-address' : 'no-conversation-for-address',
  );
}

/**
 * Provider callbacks carry no tenant, so the external address is resolved across
 * tenants. Addresses are unique per tenant and a chat address is claimed by one
 * tenant at a time; when the data does contain the address in more than one
 * tenant the call is refused instead of being resolved arbitrarily.
 */
async function findConversationByExternalAddress(
  repository: ConversationRepository,
  externalAddress: string,
): Promise<Conversation | null> {
  const matches = await repository.findByExternalAddressAnyTenant(externalAddress);
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw messageInputInvalid('inbound-external-address-ambiguous', {
      externalAddress,
      matchCount: matches.length,
    });
  }
  return matches[0] as Conversation;
}

function requireText(value: string | null | undefined, field: string): string {
  if (value === null || value === undefined || value.trim() === '') {
    throw messageInputInvalid('inbound-field-missing', { field });
  }
  return value;
}

function normalizeChannel(value: string): ChannelType {
  const candidate = (value ?? '').trim().toUpperCase();
  if (candidate === ChannelType.WHATSAPP) {
    return ChannelType.WHATSAPP;
  }
  if (candidate === ChannelType.IN_APP) {
    return ChannelType.IN_APP;
  }
  throw messageInputInvalid('inbound-channel-unsupported', { channel: value });
}

function normalizeContentType(value: string): MessageContentType {
  const candidate = (value ?? '').trim().toUpperCase();
  const fallback = MessageContentType.TEXT;
  if (candidate === '') {
    return fallback;
  }
  if (!isMessageContentType(candidate)) {
    throw messageInputInvalid('inbound-content-type-unsupported', {
      contentType: value,
    });
  }
  return candidate;
}

function normalizeOptionalAddress(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null;
  }
  try {
    return normalizeE164(value);
  } catch {
    throw messageInputInvalid('inbound-address-not-e164', { from: value });
  }
}
