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

import { messageInputInvalid } from '../errors/chat.errors.js';
import type { Message, ReadState } from '../models/entities/message.model.js';
import type { DeliveryStatus } from '../models/enums/message.enums.js';

export const MESSAGE_PAGE_MIN = 1;
export const MESSAGE_PAGE_MAX = 200;
export const MESSAGE_PAGE_DEFAULT = 50;

/**
 * Keyset cursor. `createdAt` is the primary ordering; the optional `id` breaks ties
 * so that messages sharing a timestamp never produce gaps or duplicates across
 * pages. Without an `id` the cursor degrades to a strict `createdAt <` bound.
 */
export interface MessageCursor {
  readonly createdAt: Date;
  readonly id?: string;
}

export interface MessagePageRequest {
  readonly limit: number;
  readonly cursor: MessageCursor | null;
}

export interface MessageRepository {
  findByConversation(
    tenantId: string,
    conversationId: string,
    request: MessagePageRequest,
  ): Promise<Message[]>;
  save(tenantId: string, message: Message): Promise<Message>;
  /** Tenant-scoped lookup; the default for every caller that owns a tenant. */
  findById(tenantId: string, messageId: string): Promise<Message | null>;
  /** Tenant-agnostic lookup for provider callbacks; see ConversationRepository. */
  findByIdAnyTenant(messageId: string): Promise<Message | null>;
  /**
   * Tenant-agnostic lookup for provider callbacks; see ConversationRepository.
   * Returns every match so an ambiguous provider id is refused, not guessed.
   */
  findByProviderMessageIdAnyTenant(
    providerMessageId: string,
  ): Promise<readonly Message[]>;
  findByIdInConversation(
    tenantId: string,
    conversationId: string,
    messageId: string,
  ): Promise<boolean>;
  countUnread(
    tenantId: string,
    conversationId: string,
    userId: string,
    lastReadAt: Date | null,
  ): Promise<number>;
  getLastMessage(
    tenantId: string,
    conversationId: string,
  ): Promise<Message | null>;
  updateDeliveryStatus(
    tenantId: string,
    messageId: string,
    deliveryStatus: DeliveryStatus,
    providerMessageId?: string | null,
  ): Promise<Message | null>;
}

export interface ReadStateRepository {
  find(
    tenantId: string,
    conversationId: string,
    userId: string,
  ): Promise<ReadState | null>;
  /**
   * Creates or updates the read marker. Implementations must be atomic so that
   * concurrent `markRead` calls cannot lose the newer cursor.
   */
  upsert(
    tenantId: string,
    state: Omit<ReadState, 'id' | 'tenantId'>,
  ): Promise<ReadState>;
}

/**
 * Clamps the caller supplied page size. Out-of-range and non-integer values fall
 * back to the default instead of failing the request, matching the previous
 * behaviour while keeping the upper bound that protects the database.
 */
/**
 * Resolves a requested page size into the supported range.
 *
 * A client asking for more than the maximum gets the maximum instead of an error,
 * so an oversized page size cannot turn into an unbounded database query. A missing
 * value falls back to the documented default. A negative or zero size is rejected:
 * silently switching a caller's explicit `limit: -1` to `1` hides a client bug.
 */
export function resolveMessageLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined) {
    return MESSAGE_PAGE_DEFAULT;
  }
  if (!Number.isInteger(limit) || limit < MESSAGE_PAGE_MIN) {
    throw messageInputInvalid('message-limit-out-of-range', { limit });
  }
  if (limit > MESSAGE_PAGE_MAX) {
    return MESSAGE_PAGE_MAX;
  }
  return limit;
}

export function toMessagePageRequest(
  limit: number | null | undefined,
  before: Date | null | undefined,
  beforeId?: string | null,
): MessagePageRequest {
  if (before === null || before === undefined) {
    return { limit: resolveMessageLimit(limit), cursor: null };
  }
  return {
    limit: resolveMessageLimit(limit),
    cursor:
      beforeId === null || beforeId === undefined || beforeId === ''
        ? { createdAt: before }
        : { createdAt: before, id: beforeId },
  };
}
