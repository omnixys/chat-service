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
  optionalDate,
  optionalLimit,
  requireConversationId,
  requireUuid,
} from '../models/inputs/graphql-args.js';
import { toConversationModel, toMessageModel } from '../models/mappers/chat.mapper.js';
import type { ConversationModel, MessageModel } from '../models/payloads/conversation.model.js';
import { ConversationReadService } from './conversation-read.service.js';
import { MessageReadService } from './message-read.service.js';
import { Injectable } from '@nestjs/common';

/**
 * Read-side GraphQL adapter.
 *
 * It translates transport into application-service calls. The resolver supplies
 * tenant and user IDs from the verified request context, never GraphQL arguments.
 */
@Injectable()
export class GraphqlChatReadService {
  constructor(
    private readonly conversationReads: ConversationReadService,
    private readonly messageReads: MessageReadService,
  ) {}

  async conversations(tenantId: string, userId: string): Promise<ConversationModel[]> {
    const rows = await this.conversationReads.listForUser(tenantId, userId);
    return rows.map(toConversationModel);
  }

  async conversation(
    tenantId: string,
    userId: string,
    conversationId: unknown,
  ): Promise<ConversationModel | null> {
    const row = await this.conversationReads.getForParticipant(
      tenantId,
      userId,
      requireConversationId(conversationId),
    );
    return toConversationModel(row);
  }

  async messages(
    tenantId: string,
    userId: string,
    conversationId: unknown,
    limit?: unknown,
    before?: unknown,
    beforeId?: unknown,
  ): Promise<MessageModel[]> {
    const rows = await this.messageReads.listMessages(
      tenantId,
      userId,
      requireConversationId(conversationId),
      {
        limit: optionalLimit(limit),
        before: optionalDate(before, 'before'),
        beforeId:
          beforeId === null || beforeId === undefined ? null : requireUuid(beforeId, 'beforeId'),
      },
    );
    return rows.map(toMessageModel);
  }
}
