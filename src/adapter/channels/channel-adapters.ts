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

import type { Conversation } from '../../chat/models/entities/conversation.model.js';
import { type Message } from '../../chat/models/entities/message.model.js';
import { ChannelType } from '../../chat/models/enums/conversation.enums.js';
import { DeliveryStatus } from '../../chat/models/enums/message.enums.js';
import { GATEWAY_CHANNEL_CLIENT } from '../../chat/ports/channel-adapters.token.js';
import type { GatewayChannelClient } from '../gateway/gateway.client.js';
import { type ChannelAdapter, type DeliveryOutcome } from './channel.port.js';
import { Inject, Injectable } from '@nestjs/common';

/**
 * In-app delivery is pure realtime fan-out. There is no external provider, so the
 * message counts as `SENT` as soon as the dispatcher publishes it.
 */
@Injectable()
export class InAppChannelAdapter implements ChannelAdapter {
  readonly channelType = ChannelType.IN_APP;

  async send(
    _message: Message,
    _conversation: Conversation,
  ): Promise<DeliveryOutcome> {
    return {
      deliveryStatus: DeliveryStatus.SENT,
      providerMessageId: null,
    };
  }
}

/** WhatsApp delivery is delegated to the communication gateway. */
@Injectable()
export class WhatsappChannelAdapter implements ChannelAdapter {
  readonly channelType = ChannelType.WHATSAPP;

  constructor(
    @Inject(GATEWAY_CHANNEL_CLIENT)
    private readonly gateway: GatewayChannelClient,
  ) {}

  async send(
    message: Message,
    conversation: Conversation,
  ): Promise<DeliveryOutcome> {
    if (conversation.externalAddress === null) {
      throw new Error(
        `Conversation '${conversation.id}' has no WhatsApp recipient address`,
      );
    }
    const outcome = await this.gateway.send(message, conversation);
    return {
      deliveryStatus: outcome.deliveryStatus,
      providerMessageId: outcome.providerMessageId,
    };
  }
}
