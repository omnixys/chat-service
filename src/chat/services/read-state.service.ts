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

import { conversationNotFound, messageInputInvalid } from '../errors/chat.errors.js';
import type { ReadState } from '../models/entities/message.model.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port.js';
import { Inject, Injectable } from '@nestjs/common';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';

export interface MarkReadResult {
  readonly readState: ReadState;
  readonly unreadCount: number;
}

@Injectable()
export class ReadStateService {
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(OmnixysLogger) logger: OmnixysLogger,
  ) {
    this.logger = logger.log(this.constructor.name);
  }

  /**
   * Moves the caller's read cursor forward.
   *
   * The repository upsert is atomic and refuses to move the cursor backwards, so
   * two concurrent devices racing with a stale timestamp cannot resurrect already
   * read messages as unread.
   */
  async markRead(
    tenantId: string,
    conversationId: string,
    userId: string,
    lastReadAt: Date | null,
    lastReadMessageId: string | null,
  ): Promise<MarkReadResult> {
    if (lastReadAt === null && lastReadMessageId === null) {
      throw messageInputInvalid('mark-read-requires-cursor');
    }

    return this.unitOfWork.transaction(
      async ({ conversationRepository, messageRepository, readStateRepository }) => {
        // Membership before the payload, matching the read path: a conversation the
        // caller does not belong to is indistinguishable from an unknown id.
        const isParticipant = await conversationRepository.isParticipant(
          tenantId,
          conversationId,
          userId,
        );
        if (!isParticipant) {
          throw conversationNotFound(conversationId);
        }
        const conversation = await conversationRepository.findById(tenantId, conversationId);
        if (conversation === null) {
          throw conversationNotFound(conversationId);
        }

        if (lastReadMessageId !== null) {
          const exists = await messageRepository.findByIdInConversation(
            tenantId,
            conversationId,
            lastReadMessageId,
          );
          if (!exists) {
            throw messageInputInvalid('mark-read-unknown-message', {
              lastReadMessageId,
            });
          }
        }

        const readState = await readStateRepository.upsert(tenantId, {
          conversationId,
          userId,
          lastReadAt,
          lastReadMessageId,
        });
        const unreadCount = await messageRepository.countUnread(
          tenantId,
          conversationId,
          userId,
          readState.lastReadAt,
        );

        this.logger.info('conversation_marked_read', {
          conversationId,
          lastReadAt: readState.lastReadAt?.toISOString() ?? null,
          unreadCount,
        });

        return { readState, unreadCount };
      },
    );
  }
}
