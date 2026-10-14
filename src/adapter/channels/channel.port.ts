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
import type { Message } from '../../chat/models/entities/message.model.js';
import type { ChannelType } from '../../chat/models/enums/conversation.enums.js';

export interface DeliveryOutcome {
  readonly deliveryStatus: Message['deliveryStatus'];
  readonly providerMessageId: string | null;
}

/**
 * A channel adapter performs the outbound side of a delivery. It reports the
 * resulting delivery status back to the caller instead of mutating the message,
 * which keeps the write service in control of the persistence order.
 */
export interface ChannelAdapter {
  readonly channelType: ChannelType;
  send(message: Message, conversation: Conversation): Promise<DeliveryOutcome>;
}

export interface DeliveryPolicy {
  determineChannels(
    message: Message,
    conversation: Conversation,
  ): readonly ChannelType[];
}
