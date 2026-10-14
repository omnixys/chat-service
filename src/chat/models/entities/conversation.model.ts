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

import type {
  ChannelType,
  ConversationType,
} from '../enums/conversation.enums.js';

export interface Conversation {
  readonly id: string;
  readonly tenantId: string;
  readonly type: ConversationType;
  readonly participantPairKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly participantIds: readonly string[];
  readonly channel: ChannelType;
  readonly externalAddress: string | null;
  readonly externalDisplayName: string | null;
  readonly lastMessage: string | null;
  readonly lastMessageAt: Date | null;
}

export interface ConversationPatch {
  readonly type?: ConversationType;
  readonly participantPairKey?: string;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
  readonly participantIds?: readonly string[];
  readonly channel?: ChannelType;
  readonly externalAddress?: string | null;
  readonly externalDisplayName?: string | null;
  readonly lastMessage?: string | null;
  readonly lastMessageAt?: Date | null;
}

export function conversationView(
  conversation: Conversation,
  patch: ConversationPatch,
): Conversation {
  return {
    ...conversation,
    ...stripUndefined(patch),
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

/**
 * Deterministic key for a two-participant conversation. Sorting the ids makes the
 * key independent of the caller's argument order, which is what keeps the unique
 * constraint effective for direct conversations.
 */
export function buildDirectParticipantKey(
  userAId: string,
  userBId: string,
): string {
  if (userAId === '' || userBId === '') {
    throw new EmptyUserIdError();
  }
  if (userAId === userBId) {
    throw new SameUserConversationError(userAId);
  }
  return [userAId, userBId].sort().join(':');
}

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Normalizes a phone number to E.164 and rejects everything else. */
export function normalizeE164(value: string): string {
  const normalized = value.trim().replace(/[\s().-]/g, '');
  if (!E164_PATTERN.test(normalized)) {
    throw new InvalidPhoneNumberError();
  }
  return normalized;
}

export class EmptyUserIdError extends Error {
  constructor() {
    super('User ids must not be empty');
    this.name = 'EmptyUserIdError';
  }
}

export class SameUserConversationError extends Error {
  readonly userId: string;

  constructor(userId: string) {
    super(`Cannot create a direct conversation with self: '${userId}'`);
    this.name = 'SameUserConversationError';
    this.userId = userId;
  }
}

export class InvalidPhoneNumberError extends Error {
  constructor() {
    super('Phone number must use E.164 format');
    this.name = 'InvalidPhoneNumberError';
  }
}
