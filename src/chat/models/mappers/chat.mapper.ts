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

import type { Conversation } from '../entities/conversation.model.js';
import type { Message } from '../entities/message.model.js';
import type {
  ConversationModel,
  MessageModel,
} from '../payloads/conversation.model.js';

export function toConversationModel(
  conversation: Conversation,
): ConversationModel {
  return {
    id: conversation.id,
    type: conversation.type,
    channel: conversation.channel,
    participants: conversation.participantIds.map((userId) => ({ userId })),
    externalAddress: conversation.externalAddress,
    externalDisplayName: conversation.externalDisplayName,
    lastMessage: conversation.lastMessage,
    lastMessageAt: conversation.lastMessageAt,
    /**
     * Placeholder: the unread count is per user, not a property of the conversation
     * row. `ChatResolver.unreadCount` resolves it for the caller and always wins.
     */
    unreadCount: 0,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function toMessageModel(message: Message): MessageModel {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    contentType: message.contentType,
    channel: message.channel,
    deliveryStatus: message.deliveryStatus,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
  };
}
