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

import type { AnalyticsFactWriter } from '../../analytics/analytics.port.js';
import type { ConversationRepository } from './conversation.repository.port.js';
import type {
  MessageRepository,
  ReadStateRepository,
} from './message.repository.port.js';

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface UnitOfWorkContext {
  readonly conversationRepository: ConversationRepository;
  readonly messageRepository: MessageRepository;
  readonly readStateRepository: ReadStateRepository;
  readonly analytics: AnalyticsFactWriter;
}

/**
 * Transaction boundary. Keeping it behind a port lets the application services
 * stay free of Prisma and be unit tested against in-memory repositories.
 */
export interface UnitOfWork {
  transaction<T>(work: (context: UnitOfWorkContext) => Promise<T>): Promise<T>;
}
