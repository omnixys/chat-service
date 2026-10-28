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

import type { ChannelType } from '../enums/conversation.enums.js';
import type {
  DeliveryStatus,
  MessageContentType,
} from '../enums/message.enums.js';

export interface Message {
  readonly id: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly body: string;
  readonly contentType: MessageContentType;
  readonly channel: ChannelType;
  readonly deliveryStatus: DeliveryStatus;
  readonly providerMessageId: string | null;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
}

export interface MessagePatch {
  readonly deliveryStatus?: DeliveryStatus;
  readonly providerMessageId?: string | null;
  readonly editedAt?: Date | null;
  readonly deletedAt?: Date | null;
}

export function messageView(message: Message, patch: MessagePatch): Message {
  return {
    ...message,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
  };
}

export interface ReadState {
  readonly id: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly lastReadAt: Date | null;
  readonly lastReadMessageId: string | null;
}

/** Stable keyset cursor for message history pagination. */
export interface MessageCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export class EmptyMessageError extends Error {
  constructor() {
    super('Message body must not be empty');
    this.name = 'EmptyMessageError';
  }
}
