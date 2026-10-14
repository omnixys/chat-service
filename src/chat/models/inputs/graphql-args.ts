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

import { messageInputInvalid } from '../../errors/chat.errors.js';
import { ConversationType } from '../enums/conversation.enums.js';
import { MessageContentType } from '../enums/message.enums.js';

/**
 * Argument validation for the flat GraphQL contract.
 *
 * The preserved schema passes plain scalars (`conversationId`, `body`,
 * `phoneNumber`, ...), so there is no `@InputType` object the global
 * `ValidationPipe` could validate. These helpers take over that job at the same
 * boundary and raise the same canonical `MESSAGE_INPUT_INVALID` error the REST
 * transport produces, which keeps both transports reporting one error contract.
 *
 * Values are never coerced silently: an argument that cannot be used as sent is
 * rejected instead of being repaired, except for `displayName`, where an empty
 * string means "no display name" exactly like the absent argument.
 */

/** `+` followed by 7 to 15 digits, first digit non-zero. */
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_BODY_LENGTH = 64_000;

const MAX_DISPLAY_NAME_LENGTH = 255;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw messageInputInvalid('graphql-argument-invalid', {
      field,
      expected: 'uuid',
    });
  }
  return value.trim();
}

export function requireConversationId(value: unknown): string {
  return requireUuid(value, 'conversationId');
}

export function requireParticipantUserId(value: unknown): string {
  return requireUuid(value, 'participantUserId');
}

export function requirePhoneNumber(value: unknown): string {
  const phone = typeof value === 'string' ? value.trim() : '';
  if (!E164_PATTERN.test(phone)) {
    throw messageInputInvalid('graphql-argument-invalid', {
      field: 'phoneNumber',
      expected: 'e164',
    });
  }
  return phone;
}

export function requireBody(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw messageInputInvalid('graphql-argument-invalid', {
      field: 'body',
      expected: 'non-empty-string',
    });
  }
  if (value.length > MAX_BODY_LENGTH) {
    throw messageInputInvalid('graphql-argument-invalid', {
      field: 'body',
      expected: `max-${MAX_BODY_LENGTH}-characters`,
    });
  }
  return value;
}

/** An absent or blank display name means the conversation has none. */
export function optionalDisplayName(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw messageInputInvalid('graphql-argument-invalid', {
      field: 'displayName',
      expected: 'string',
    });
  }
  const displayName = value.trim();
  if (displayName === '') {
    return null;
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw messageInputInvalid('graphql-argument-invalid', {
      field: 'displayName',
      expected: `max-${MAX_DISPLAY_NAME_LENGTH}-characters`,
    });
  }
  return displayName;
}

/**
 * Page size is clamped by the read service instead of being rejected here, so a
 * client that asks for more rows than the contract allows still gets a page back.
 */
export function optionalLimit(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw messageInputInvalid('graphql-argument-invalid', {
      field: 'limit',
      expected: 'integer',
    });
  }
  return value;
}

export function optionalDate(value: unknown, field: string): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw messageInputInvalid('graphql-argument-invalid', {
      field,
      expected: 'date-time',
    });
  }
  return value;
}

export function optionalConversationType(
  value: unknown,
): ConversationType | null {
  return optionalEnum(value, ConversationType, 'conversationType');
}

export function optionalContentType(value: unknown): MessageContentType | null {
  return optionalEnum(value, MessageContentType, 'contentType');
}

/** GraphQL already constrains enums; this only guards hand-built calls. */
export function optionalEnum<T extends string>(
  value: unknown,
  allowed: Readonly<Record<string, T>>,
  field: string,
): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !(value in allowed)) {
    throw messageInputInvalid('graphql-argument-invalid', {
      field,
      expected: Object.keys(allowed).join('|'),
    });
  }
  return allowed[value] as T;
}
