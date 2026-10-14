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
import type { Conversation } from '../models/entities/conversation.model.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port.js';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Read side of the conversation aggregate.
 *
 * Authorization is always evaluated before existence: an unknown conversation
 * and a conversation the caller may not see produce the same
 * `CONVERSATION_NOT_FOUND` result, so probing ids cannot enumerate traffic.
 */
@Injectable()
export class ConversationReadService {
  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  async listForUser(tenantId: string, userId: string): Promise<Conversation[]> {
    return this.unitOfWork.transaction(({ conversationRepository }) =>
      conversationRepository.findByUserId(tenantId, userId),
    );
  }

  async getForParticipant(
    tenantId: string,
    userId: string,
    conversationId: string,
  ): Promise<Conversation> {
    return this.unitOfWork.transaction(async ({ conversationRepository }) => {
      // Membership is evaluated first: an unknown conversation and a conversation
      // the caller may not read are indistinguishable, so ids cannot be probed.
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
      return conversation;
    });
  }

  /**
   * Internal endpoint contract used by the gateway: `204` when the user may read
   * the conversation, `403` when they are not a participant, `404` when the
   * conversation does not exist.
   */
  async checkParticipantAccess(
    conversationId: string,
    userId: string,
  ): Promise<'allowed' | 'forbidden' | 'not-found'> {
    return this.unitOfWork.transaction(
      async ({ conversationRepository }): Promise<'allowed' | 'forbidden' | 'not-found'> => {
        const conversation = await conversationRepository.findByIdAnyTenant(conversationId);
        if (conversation === null) {
          return 'not-found';
        }
        const isParticipant = await conversationRepository.isParticipant(
          conversation.tenantId,
          conversationId,
          userId,
        );
        return isParticipant ? 'allowed' : 'forbidden';
      },
    );
  }
}
