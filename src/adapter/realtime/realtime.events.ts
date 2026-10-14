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

import type { ChannelType } from '../../chat/models/enums/conversation.enums.js';
import type {
  DeliveryStatus,
  MessageContentType,
} from '../../chat/models/enums/message.enums.js';

/**
 * Wire format of a realtime chat event.
 *
 * The gateway consumes the exact same field names from `chat:conversation:*` and
 * `chat:user:*`, so the camelCase contract here is part of the platform API and
 * must not change.
 */
export interface MessageCreatedEvent {
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly body: string;
  readonly contentType: MessageContentType;
  readonly channel: ChannelType;
  readonly deliveryStatus: DeliveryStatus;
  readonly createdAt: string;
}

export function conversationChannel(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export function userChannel(userId: string): string {
  return `user:${userId}`;
}

/** Valkey/Redis channel including the service prefix, shared with the gateway. */
export function transportChannel(channel: string): string {
  return `chat:${channel}`;
}

export function eventChannels(
  conversationId: string,
  participantIds: readonly string[],
): readonly string[] {
  return [
    conversationChannel(conversationId),
    ...participantIds.map(userChannel),
  ];
}
