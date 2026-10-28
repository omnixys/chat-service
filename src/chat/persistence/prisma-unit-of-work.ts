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

import { PrismaAnalyticsFactWriter } from '../../analytics/analytics-outbox.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
  type UnitOfWorkContext,
} from '../ports/unit-of-work.port.js';
import {
  PrismaConversationRepository,
  PrismaMessageRepository,
  PrismaReadStateRepository,
} from './prisma-chat.repository.js';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Prisma implementation of the unit of work.
 *
 * Each repository is constructed from the transaction client, which is what makes
 * the transactional outbox atomic together with the business write.
 */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  // Explicit token: the Prisma client types emit `Function` into
  // `design:paramtypes`, so Nest would otherwise look for a provider named
  // `Function`.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async transaction<T>(
    work: (context: UnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) =>
      work({
        conversationRepository: new PrismaConversationRepository(tx),
        messageRepository: new PrismaMessageRepository(tx),
        readStateRepository: new PrismaReadStateRepository(tx),
        analytics: new PrismaAnalyticsFactWriter(tx),
      }),
    );
  }
}

export const UNIT_OF_WORK_PROVIDER = {
  provide: UNIT_OF_WORK,
  useClass: PrismaUnitOfWork,
};
