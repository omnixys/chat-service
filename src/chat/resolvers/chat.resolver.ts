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
  conversationChannel,
  userChannel,
  type MessageCreatedEvent,
} from '../../adapter/realtime/realtime.events.js';
import {
  REALTIME_PUBLISHER,
  type RealtimePublisher,
} from '../../adapter/realtime/realtime.port.js';
import {
  authenticationRequired,
  verifiedTenantRequired,
} from '../errors/principal.errors.js';
import { ConversationType } from '../models/enums/conversation.enums.js';
import { MessageContentType } from '../models/enums/message.enums.js';
import { toConversationModel } from '../models/mappers/chat.mapper.js';
import {
  ConversationModel,
  MessageModel,
} from '../models/payloads/conversation.model.js';
import { MESSAGE_PAGE_DEFAULT } from '../ports/message.repository.port.js';
import { ConversationReadService } from '../services/conversation-read.service.js';
import { GraphqlChatReadService } from '../services/graphql-chat-read.service.js';
import { GraphqlChatWriteService } from '../services/graphql-chat-write.service.js';
import { MessageReadService } from '../services/message-read.service.js';
import { Inject, UseGuards } from '@nestjs/common';
import {
  Args,
  GraphQLISODateTime,
  ID,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
  Subscription,
} from '@nestjs/graphql';
import { ContextAccessor } from '@omnixys/context-ts';
import { PrincipalType } from '@omnixys/contracts-ts';
import { HeaderAuthGuard } from '@omnixys/security-ts';
import { isUUID } from 'class-validator';
import { from, map, switchMap, type Observable } from 'rxjs';

/**
 * GraphQL entry points.
 *
 * Resolvers stay thin: they resolve the verified principal, delegate to the
 * application services and project the result. `@ResolveField` runs in the caller's
 * context, so `unreadCount` uses the same verified tenant and user as its parent
 * and cannot be used to probe another conversation.
 *
 * Argument names and nullability reproduce the preserved schema exactly; the
 * optional `beforeId`, `contentType`, `lastReadAt` and `lastReadMessageId`
 * arguments are additive and keep the original calls valid.
 */
@UseGuards(HeaderAuthGuard)
@Resolver(() => ConversationModel)
export class ChatResolver {
  constructor(
    private readonly read: GraphqlChatReadService,
    private readonly write: GraphqlChatWriteService,
    private readonly conversations: ConversationReadService,
    private readonly messageReads: MessageReadService,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
  ) {}

  private identity(): {
    tenantId: string;
    userId: string;
    correlationId?: string;
  } {
    const snapshot = ContextAccessor.get();
    const tenant = snapshot?.tenant;
    if (!tenant?.verified || !isUUID(tenant.tenantId)) {
      throw verifiedTenantRequired();
    }
    if (
      snapshot?.principal?.tenantId !== undefined &&
      snapshot.principal.tenantId !== tenant.tenantId
    ) {
      throw verifiedTenantRequired();
    }
    const principal = snapshot?.principal;
    if (principal?.principalType !== PrincipalType.USER || !principal.userId) {
      throw authenticationRequired('user-principal-required');
    }
    return {
      tenantId: tenant.tenantId,
      userId: principal.userId,
      correlationId: snapshot?.correlationId,
    };
  }

  @Query(() => [ConversationModel], { name: 'conversations' })
  listConversations(): Promise<ConversationModel[]> {
    const { tenantId, userId } = this.identity();
    return this.read.conversations(tenantId, userId);
  }

  @Query(() => ConversationModel, { name: 'conversation', nullable: true })
  getConversation(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ConversationModel | null> {
    const { tenantId, userId } = this.identity();
    return this.read.conversation(tenantId, userId, id);
  }

  @Query(() => [MessageModel], { name: 'messages' })
  listMessages(
    @Args('conversationId', { type: () => ID }) conversationId: string,
    @Args('limit', {
      type: () => Int,
      nullable: true,
      defaultValue: MESSAGE_PAGE_DEFAULT,
    })
    limit?: number,
    @Args('before', { type: () => GraphQLISODateTime, nullable: true })
    before?: Date | null,
    @Args('beforeId', { type: () => ID, nullable: true })
    beforeId?: string | null,
  ): Promise<MessageModel[]> {
    const { tenantId, userId } = this.identity();
    return this.read.messages(
      tenantId,
      userId,
      conversationId,
      limit,
      before,
      beforeId,
    );
  }

  @Mutation(() => ConversationModel, { name: 'createInAppConversation' })
  createInAppConversation(
    @Args('participantUserId', { type: () => String })
    participantUserId: string,
    @Args('conversationType', {
      type: () => ConversationType,
      nullable: true,
      defaultValue: ConversationType.DIRECT,
    })
    conversationType?: ConversationType,
  ): Promise<ConversationModel> {
    const { tenantId, userId } = this.identity();
    return this.write.createInAppConversation(
      tenantId,
      userId,
      participantUserId,
      conversationType,
    );
  }

  @Mutation(() => ConversationModel, { name: 'createWhatsappConversation' })
  createWhatsappConversation(
    @Args('phoneNumber', { type: () => String }) phoneNumber: string,
    @Args('displayName', { type: () => String, nullable: true })
    displayName?: string | null,
  ): Promise<ConversationModel> {
    const { tenantId, userId } = this.identity();
    return this.write.createWhatsappConversation(
      tenantId,
      userId,
      phoneNumber,
      displayName,
    );
  }

  @Mutation(() => MessageModel, { name: 'sendMessage' })
  sendMessage(
    @Args('conversationId', { type: () => ID }) conversationId: string,
    @Args('body', { type: () => String }) body: string,
    @Args('contentType', {
      type: () => MessageContentType,
      nullable: true,
      defaultValue: MessageContentType.TEXT,
    })
    contentType?: MessageContentType,
  ): Promise<MessageModel> {
    const { tenantId, userId, correlationId } = this.identity();
    return this.write.sendMessage(
      tenantId,
      userId,
      conversationId,
      body,
      contentType,
      correlationId,
    );
  }

  @Mutation(() => Boolean, { name: 'markRead' })
  markRead(
    @Args('conversationId', { type: () => ID }) conversationId: string,
    @Args('lastReadAt', { type: () => GraphQLISODateTime, nullable: true })
    lastReadAt?: Date | null,
    @Args('lastReadMessageId', { type: () => ID, nullable: true })
    lastReadMessageId?: string | null,
  ): Promise<boolean> {
    const { tenantId, userId } = this.identity();
    return this.write.markRead(
      tenantId,
      userId,
      conversationId,
      lastReadAt,
      lastReadMessageId,
    );
  }

  @ResolveField(() => Int, { name: 'unreadCount' })
  unreadCount(@Parent() conversation: ConversationModel): Promise<number> {
    const { tenantId, userId } = this.identity();
    return this.messageReads.countUnread(tenantId, userId, conversation.id);
  }

  /**
   * Stream of messages for one conversation.
   *
   * The participant check is awaited *before* the realtime subscription is opened:
   * `from(promise).pipe(switchMap(...))` does not emit until the check resolved, so
   * a non-participant gets an errored subscription instead of an open stream.
   */
  @Subscription(() => MessageModel, {
    name: 'messageReceived',
    description: 'Every message in a conversation the caller participates in.',
  })
  messageReceived(
    @Args('conversationId', { type: () => ID }) conversationId: string,
  ): Observable<MessageModel> {
    const { tenantId, userId } = this.identity();
    return from(
      this.conversations.getForParticipant(tenantId, userId, conversationId),
    ).pipe(
      switchMap(() =>
        this.realtime.subscribe(conversationChannel(conversationId)),
      ),
      map(toMessageModelFromEvent),
    );
  }

  /**
   * Stream of conversation changes for the caller.
   *
   * The event carries the message that triggered the change; the conversation is
   * re-read so the payload is truthful instead of a partially filled projection.
   */
  @Subscription(() => ConversationModel, {
    name: 'conversationUpdated',
    description: 'A conversation the caller participates in changed.',
  })
  conversationUpdated(): Observable<ConversationModel> {
    const { tenantId, userId } = this.identity();
    return this.realtime.subscribe(userChannel(userId)).pipe(
      switchMap((event: MessageCreatedEvent) =>
        from(
          this.conversations.getForParticipant(
            tenantId,
            userId,
            event.conversationId,
          ),
        ),
      ),
      map(toConversationModel),
    );
  }
}

/**
 * Projects a realtime event onto the GraphQL message shape.
 *
 * The event is the wire contract published to Valkey; it carries no edit or delete
 * state, so those fields are absent rather than invented.
 */
function toMessageModelFromEvent(event: MessageCreatedEvent): MessageModel {
  return {
    id: event.messageId,
    conversationId: event.conversationId,
    senderId: event.senderId,
    body: event.body,
    contentType: event.contentType,
    channel: event.channel,
    deliveryStatus: event.deliveryStatus,
    createdAt: new Date(event.createdAt),
    editedAt: null,
    deletedAt: null,
  };
}
