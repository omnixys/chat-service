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

import { conversationNotFound } from '../errors/chat.errors.js';
import type { Message } from '../models/entities/message.model.js';
import { toMessagePageRequest } from '../ports/message.repository.port.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port.js';
import { Inject, Injectable } from '@nestjs/common';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';

@Injectable()
export class MessageReadService {
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(OmnixysLogger) logger: OmnixysLogger,
  ) {
    this.logger = logger.log(this.constructor.name);
  }

  /**
   * Returns the newest page of a conversation, ordered oldest-first so the caller
   * can render it top-down. The keyset cursor is `(createdAt, id)`; without an
   * id the bound degrades to a strict `createdAt <` comparison.
   */
  async listMessages(
    tenantId: string,
    userId: string,
    conversationId: string,
    options: {
      limit?: number | null;
      before?: Date | null;
      beforeId?: string | null;
    },
  ): Promise<Message[]> {
    const request = toMessagePageRequest(options.limit, options.before, options.beforeId);

    const rows = await this.unitOfWork.transaction(
      async ({ conversationRepository, messageRepository }) => {
        const isParticipant = await conversationRepository.isParticipant(
          tenantId,
          conversationId,
          userId,
        );
        // Membership is evaluated first, exactly like in `ConversationReadService`:
        // an unknown conversation and a conversation the caller may not read are
        // indistinguishable, so a message page cannot be used to probe ids.
        if (!isParticipant) {
          throw conversationNotFound(conversationId);
        }

        const page = await messageRepository.findByConversation(tenantId, conversationId, request);
        this.logger.debug('messages_read', {
          conversationId,
          limit: request.limit,
          returned: page.length,
        });
        return page;
      },
    );

    return rows.reverse();
  }

  async countUnread(tenantId: string, userId: string, conversationId: string): Promise<number> {
    return this.unitOfWork.transaction(
      async ({ conversationRepository, messageRepository, readStateRepository }) => {
        const isParticipant = await conversationRepository.isParticipant(
          tenantId,
          conversationId,
          userId,
        );
        if (!isParticipant) {
          throw conversationNotFound(conversationId);
        }
        const readState = await readStateRepository.find(tenantId, conversationId, userId);
        return messageRepository.countUnread(
          tenantId,
          conversationId,
          userId,
          readState?.lastReadAt ?? null,
        );
      },
    );
  }
}
