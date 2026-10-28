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
  ConversationNotFoundException,
  ErrorCode,
  FrameworkException,
} from '@omnixys/contracts-ts';

/**
 * Domain failures are raised as `FrameworkException` subclasses so that the
 * GraphQL error mapper, the REST error mapper and the gateway observe the same
 * canonical `errorId` without any per-transport mapping in the services.
 *
 * Membership failures raise `CONVERSATION_NOT_FOUND` on every caller-facing path:
 * an id the caller may not read and an id that does not exist must stay
 * indistinguishable. The trusted gateway endpoint is the single exception and
 * answers `403`/`404` explicitly.
 *
 * Detail arguments are passed as `diagnostics`, because the exception strips every
 * metadata key that is not declared public for the error code. Passing them as
 * `metadata` would silently drop them and leave an operator without a reason.
 */
export function conversationNotFound(
  conversationId: string,
): FrameworkException {
  return new ConversationNotFoundException(conversationId);
}

export function messageInputInvalid(
  reason: string,
  metadata?: Readonly<Record<string, unknown>>,
): FrameworkException {
  return new FrameworkException(ErrorCode.MESSAGE_INPUT_INVALID, {
    diagnostics: { reason, ...metadata },
  });
}

export function deliveryStatusTransitionInvalid(
  messageId: string,
  currentStatus: string,
  attemptedStatus: string,
): FrameworkException {
  return new FrameworkException(ErrorCode.MESSAGE_INPUT_INVALID, {
    diagnostics: {
      reason: 'invalid-delivery-status-transition',
      messageId,
      currentStatus,
      attemptedStatus,
    },
    httpStatus: 409,
  });
}

export function unmatchedInboundMessage(reason: string): FrameworkException {
  return new FrameworkException(ErrorCode.MESSAGE_INPUT_INVALID, {
    diagnostics: { reason: 'unmatched-inbound-message', detail: reason },
    httpStatus: 422,
  });
}
