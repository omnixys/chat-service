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

export const MessageContentType = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  FILE: 'FILE',
  SYSTEM: 'SYSTEM',
} as const;
export type MessageContentType =
  (typeof MessageContentType)[keyof typeof MessageContentType];

export const MESSAGE_CONTENT_TYPES: readonly MessageContentType[] =
  Object.values(MessageContentType);

export const DeliveryStatus = {
  UNKNOWN: 'UNKNOWN',
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type DeliveryStatus =
  (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const DELIVERY_STATUSES: readonly DeliveryStatus[] =
  Object.values(DeliveryStatus);

export function isMessageContentType(
  value: string,
): value is MessageContentType {
  return (MESSAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

export function isDeliveryStatus(value: string): value is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(value);
}

/**
 * Providers do not report status transitions in a fixed order: a webhook may
 * deliver `DELIVERED` for a message that is still `PENDING` locally. The
 * lifecycle is therefore modelled as a monotonic rank rather than as an explicit
 * edge list. Terminal states are final, so a late `SENT` callback cannot undo a
 * confirmed `READ`.
 */
const STATUS_RANK: Readonly<Record<DeliveryStatus, number>> = Object.freeze({
  [DeliveryStatus.UNKNOWN]: 0,
  [DeliveryStatus.PENDING]: 1,
  [DeliveryStatus.QUEUED]: 2,
  [DeliveryStatus.SENT]: 3,
  [DeliveryStatus.DELIVERED]: 4,
  [DeliveryStatus.READ]: 5,
  [DeliveryStatus.FAILED]: 5,
  [DeliveryStatus.CANCELLED]: 5,
});

const TERMINAL_STATUSES: readonly DeliveryStatus[] = [
  DeliveryStatus.READ,
  DeliveryStatus.FAILED,
  DeliveryStatus.CANCELLED,
];

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransitionDeliveryStatus(
  current: DeliveryStatus,
  target: DeliveryStatus,
): boolean {
  if (current === target) {
    return true;
  }
  if (isTerminalDeliveryStatus(current)) {
    return false;
  }
  return STATUS_RANK[target] > STATUS_RANK[current];
}
