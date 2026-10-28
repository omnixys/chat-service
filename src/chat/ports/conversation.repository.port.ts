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

import type { Conversation } from '../models/entities/conversation.model.js';

/**
 * Every method takes the tenant explicitly. Tenant isolation is a hard boundary,
 * so it must be visible at each call site instead of being hidden in ambient
 * request state.
 */
export interface ConversationRepository {
  findById(
    tenantId: string,
    conversationId: string,
  ): Promise<Conversation | null>;
  /**
   * Tenant-agnostic lookup used by the internal provider callback endpoints.
   * Conversation ids are globally unique UUIDs and the caller returns nothing but
   * a boolean, so no cross-tenant payload can leak through this method.
   */
  findByIdAnyTenant(conversationId: string): Promise<Conversation | null>;
  findByParticipantPairKey(
    tenantId: string,
    participantPairKey: string,
  ): Promise<Conversation | null>;
  findByUserId(tenantId: string, userId: string): Promise<Conversation[]>;
  findByExternalAddress(
    tenantId: string,
    externalAddress: string,
  ): Promise<Conversation | null>;
  /**
   * Provider callbacks carry no tenant. Returns every tenant that owns the
   * address so the caller can refuse an ambiguous match instead of picking one.
   */
  findByExternalAddressAnyTenant(
    externalAddress: string,
  ): Promise<readonly Conversation[]>;
  save(tenantId: string, conversation: Conversation): Promise<Conversation>;
  addParticipant(
    tenantId: string,
    conversationId: string,
    userId: string,
  ): Promise<void>;
  isParticipant(
    tenantId: string,
    conversationId: string,
    userId: string,
  ): Promise<boolean>;
  getParticipantIds(
    tenantId: string,
    conversationId: string,
  ): Promise<readonly string[]>;
  touch(tenantId: string, conversationId: string, at: Date): Promise<void>;
}
