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

import type { ChannelAdapter, DeliveryPolicy } from '../../adapter/channels/channel.port.js';
import { eventChannels, type MessageCreatedEvent } from '../../adapter/realtime/realtime.events.js';
import {
  REALTIME_PUBLISHER,
  type RealtimePublisher,
} from '../../adapter/realtime/realtime.port.js';
import { messageInputInvalid } from '../errors/chat.errors.js';
import type { Conversation } from '../models/entities/conversation.model.js';
import { type Message } from '../models/entities/message.model.js';
import { DeliveryStatus } from '../models/enums/message.enums.js';
import { CHANNEL_DELIVERY_ADAPTERS } from '../ports/channel-adapters.token.js';
import { DEFAULT_DELIVERY_POLICY } from '../ports/delivery-policy.token.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port.js';
import { Inject, Injectable } from '@nestjs/common';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';

export interface DispatchResult {
  readonly message: Message;
  readonly publishedChannels: readonly string[];
}

/**
 * Performs the outbound side of a stored message: runs the channel adapter and
 * then fans the event out to realtime subscribers.
 *
 * The message is already committed when this runs. A failing adapter therefore
 * marks the delivery as `FAILED` and still publishes, so connected clients see
 * the failure instead of waiting forever.
 */
@Injectable()
export class MessageDispatcher {
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CHANNEL_DELIVERY_ADAPTERS)
    private readonly adapters: readonly ChannelAdapter[],
    @Inject(DEFAULT_DELIVERY_POLICY) private readonly deliveryPolicy: DeliveryPolicy,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(OmnixysLogger) logger: OmnixysLogger,
  ) {
    this.logger = logger.log(this.constructor.name);
  }

  async dispatch(messageId: string, tenantId: string): Promise<DispatchResult> {
    const message = await this.loadMessage(messageId, tenantId);
    const conversation = await this.loadConversation(tenantId, message.conversationId);
    const participantIds = await this.loadParticipantIds(tenantId, conversation.id);

    const updated = await this.runAdapters(tenantId, message, conversation);
    const publishedChannels = await this.publish(updated, participantIds);

    return { message: updated, publishedChannels };
  }

  private async runAdapters(
    tenantId: string,
    message: Message,
    conversation: Conversation,
  ): Promise<Message> {
    const targets = this.deliveryPolicy.determineChannels(message, conversation);
    const adapter = this.adapters.find((candidate) => candidate.channelType === message.channel);

    if (adapter === undefined) {
      this.logger.warn('no_channel_adapter', {
        messageId: message.id,
        channel: message.channel,
      });
      return message;
    }
    if (targets.length === 0) {
      return message;
    }

    try {
      const outcome = await adapter.send(message, conversation);
      const persisted = await this.updateDelivery(
        tenantId,
        message,
        outcome.deliveryStatus,
        outcome.providerMessageId,
      );
      return persisted;
    } catch (cause) {
      this.logger.error('channel_delivery_failed', {
        messageId: message.id,
        channel: message.channel,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return this.updateDelivery(tenantId, message, DeliveryStatus.FAILED, null);
    }
  }

  private async updateDelivery(
    tenantId: string,
    message: Message,
    deliveryStatus: Message['deliveryStatus'],
    providerMessageId: string | null,
  ): Promise<Message> {
    return this.unitOfWork.transaction(async ({ messageRepository }) => {
      const updated = await messageRepository.updateDeliveryStatus(
        tenantId,
        message.id,
        deliveryStatus,
        providerMessageId,
      );
      if (updated === null) {
        throw messageInputInvalid('delivery-status-update-lost-race');
      }
      return updated;
    });
  }

  private async publish(
    message: Message,
    participantIds: readonly string[],
  ): Promise<readonly string[]> {
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

    const channels = eventChannels(message.conversationId, participantIds);
    await Promise.all(channels.map((channel) => this.realtime.publish(channel, event)));
    return channels;
  }

  /**
   * The message is loaded inside the caller's tenant. Dispatch runs after commit
   * and is not reached through an authenticated GraphQL call, so the tenant is
   * taken from the dispatch command and enforced here instead of being trusted.
   */
  private async loadMessage(messageId: string, tenantId: string): Promise<Message> {
    const message = await this.unitOfWork.transaction(({ messageRepository }) =>
      messageRepository.findById(tenantId, messageId),
    );
    if (message === null) {
      throw messageInputInvalid('unknown-message', { messageId, tenantId });
    }
    return message;
  }

  private async loadConversation(tenantId: string, conversationId: string): Promise<Conversation> {
    const conversation = await this.unitOfWork.transaction(({ conversationRepository }) =>
      conversationRepository.findById(tenantId, conversationId),
    );
    if (conversation === null) {
      throw messageInputInvalid('unknown-conversation', { conversationId });
    }
    return conversation;
  }

  private async loadParticipantIds(
    tenantId: string,
    conversationId: string,
  ): Promise<readonly string[]> {
    return this.unitOfWork.transaction(({ conversationRepository }) =>
      conversationRepository.getParticipantIds(tenantId, conversationId),
    );
  }
}
