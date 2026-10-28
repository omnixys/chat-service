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

import { ChannelType, ConversationType } from '../enums/conversation.enums.js';
import { DeliveryStatus, MessageContentType } from '../enums/message.enums.js';
import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

registerEnumType(ChannelType, {
  name: 'ChannelType',
  description: 'Channel a conversation is carried on.',
});
registerEnumType(ConversationType, {
  name: 'ConversationType',
  description: 'Kind of conversation.',
});
registerEnumType(MessageContentType, {
  name: 'MessageContentType',
  description: 'Kind of payload a message carries.',
});
registerEnumType(DeliveryStatus, {
  name: 'DeliveryStatus',
  description: 'Delivery lifecycle state of a message.',
});

/**
 * GraphQL projection of a conversation participant.
 *
 * Participants are projected as objects, not as a list of ids, because that is the
 * shape the preserved schema exposes and clients select `participants { userId }`.
 */
@ObjectType('Participant')
export class ParticipantModel {
  @Field(() => ID)
  userId!: string;
}

/**
 * GraphQL projection of a conversation.
 *
 * The scalar names are the federated contract and must not change; the gateway
 * forwards these objects verbatim to its clients.
 */
@ObjectType('Conversation')
export class ConversationModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ConversationType)
  type!: ConversationType;

  @Field(() => ChannelType)
  channel!: ChannelType;

  @Field(() => [ParticipantModel])
  participants!: ParticipantModel[];

  @Field(() => String, { nullable: true })
  externalAddress?: string | null;

  @Field(() => String, { nullable: true })
  externalDisplayName?: string | null;

  @Field(() => String, { nullable: true })
  lastMessage?: string | null;

  @Field(() => Date, { nullable: true })
  lastMessageAt?: Date | null;

  @Field(() => Int)
  unreadCount!: number;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

@ObjectType('Message')
export class MessageModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  conversationId!: string;

  @Field(() => String)
  senderId!: string;

  @Field(() => String)
  body!: string;

  @Field(() => MessageContentType)
  contentType!: MessageContentType;

  @Field(() => ChannelType)
  channel!: ChannelType;

  @Field(() => DeliveryStatus)
  deliveryStatus!: DeliveryStatus;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date, { nullable: true })
  editedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
