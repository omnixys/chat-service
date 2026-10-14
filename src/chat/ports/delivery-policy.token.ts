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

import type { DeliveryPolicy } from '../../adapter/channels/channel.port.js';
import type { Conversation } from '../models/entities/conversation.model.js';
import { type Message } from '../models/entities/message.model.js';
import { ChannelType } from '../models/enums/conversation.enums.js';
import { MessageContentType } from '../models/enums/message.enums.js';

export const DEFAULT_DELIVERY_POLICY = Symbol('DEFAULT_DELIVERY_POLICY');

/**
 * The conversation channel is the single delivery target: the previous Python
 * implementation fanned every message out to every adapter, which duplicated
 * traffic on WhatsApp and double-counted analytics. Keeping the decision in one
 * place makes the fan-out rule testable and keeps the adapters dumb.
 *
 * `SYSTEM` messages stay in-app only; a system notice must never leave the
 * platform through a customer-facing channel.
 */
export const defaultDeliveryPolicy: DeliveryPolicy = {
  determineChannels(
    message: Message,
    conversation: Conversation,
  ): readonly ChannelType[] {
    if (message.contentType === MessageContentType.SYSTEM) {
      return [ChannelType.IN_APP];
    }
    return [conversation.channel];
  },
};
