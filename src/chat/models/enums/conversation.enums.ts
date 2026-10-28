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

/**
 * Persistence and contract enums for the conversation aggregate.
 *
 * These values are stored verbatim in `VARCHAR` columns, so the string literals are
 * part of the database contract and must not be renamed.
 */
export const ConversationType = {
  DIRECT: 'DIRECT',
  GROUP: 'GROUP',
  CHANNEL: 'CHANNEL',
  SUPPORT: 'SUPPORT',
} as const;

export type ConversationType =
  (typeof ConversationType)[keyof typeof ConversationType];

export const CONVERSATION_TYPES: readonly ConversationType[] =
  Object.values(ConversationType);

/**
 * Channels the chat service can deliver on.
 *
 * `EMAIL` and `SMS` remain part of the schema because the subgraph is already
 * federated and other services reference them; the chat service itself only
 * implements adapters for `IN_APP` and `WHATSAPP`.
 */
export const ChannelType = {
  IN_APP: 'IN_APP',
  WHATSAPP: 'WHATSAPP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
} as const;

export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const CHANNEL_TYPES: readonly ChannelType[] = Object.values(ChannelType);

/** Channels this service is able to deliver on. */
export const SUPPORTED_CHANNEL_TYPES: readonly ChannelType[] = [
  ChannelType.IN_APP,
  ChannelType.WHATSAPP,
];

export function isChannelType(value: string): value is ChannelType {
  return (CHANNEL_TYPES as readonly string[]).includes(value);
}

export function isConversationType(value: string): value is ConversationType {
  return (CONVERSATION_TYPES as readonly string[]).includes(value);
}
