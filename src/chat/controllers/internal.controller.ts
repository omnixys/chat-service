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
  DeliveryStatusResponse,
  InboundMessageResponse,
} from '../models/dtos/internal.dto.js';
import { DeliveryStatusDto, InboundMessageDto } from '../models/dtos/internal.dto.js';
import { ConversationReadService } from '../services/conversation-read.service.js';
import { InboundMessageService } from '../services/inbound-message.service.js';
import { MessageWriteService } from '../services/message-write.service.js';
import { InternalApiKeyGuard } from './internal-api-key.guard.js';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ContextAccessor } from '@omnixys/context-ts';
import { Public } from '@omnixys/security-ts';

/**
 * Service-to-service API used by the gateway's subscription resolver and by
 * provider webhooks.
 *
 * `@Public()` removes the global user-authentication guard, which is correct here:
 * these calls carry an internal API key instead of a user token.
 * `InternalApiKeyGuard` is the only authentication and it fails closed.
 */
@Public()
@UseGuards(InternalApiKeyGuard)
@Controller('api/v1/internal')
export class InternalChatController {
  constructor(
    private readonly conversations: ConversationReadService,
    private readonly inbound: InboundMessageService,
    private readonly messages: MessageWriteService,
  ) {}

  /**
   * `204` when the user may read the conversation. The gateway maps `403` to
   * `CONVERSATION_ACCESS_DENIED` and `404` to `CONVERSATION_NOT_FOUND`; any other
   * status it reports as `DEPENDENCY_UNAVAILABLE`, so an authentication failure
   * must never be reported as `204`.
   */
  @Get('conversations/:conversationId/participants/:userId')
  // Nest answers a GET that returns nothing with 200; the gateway contract is 204.
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyParticipant(
    @Param('conversationId') conversationId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    const outcome = await this.conversations.checkParticipantAccess(conversationId, userId);
    switch (outcome) {
      case 'allowed':
        return;
      case 'forbidden':
        throw new HttpException({ code: 'CONVERSATION_ACCESS_DENIED' }, HttpStatus.FORBIDDEN);
      case 'not-found':
        throw new HttpException({ code: 'CONVERSATION_NOT_FOUND' }, HttpStatus.NOT_FOUND);
    }
  }

  @Post('inbound-message')
  async inboundMessage(@Body() dto: InboundMessageDto): Promise<InboundMessageResponse> {
    const result = await this.inbound.handle({
      messageId: dto.message_id,
      channel: dto.channel,
      userId: dto.user_id ?? '',
      from: dto.senderAddress ?? '',
      body: dto.body ?? '',
      contentType: dto.content_type ?? 'TEXT',
      conversationId: dto.conversation_id ?? null,
    });

    return {
      id: result.message.id,
      conversation_id: result.message.conversationId,
      sender_id: result.message.senderId,
      body: result.message.body,
      channel: result.message.channel,
      delivery_status: result.message.deliveryStatus,
      created_at: result.message.createdAt.toISOString(),
      duplicate: result.duplicate,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('delivery-status')
  async deliveryStatus(@Body() dto: DeliveryStatusDto): Promise<DeliveryStatusResponse> {
    const correlationId = ContextAccessor.get()?.correlationId;
    const updated = await this.messages.applyDeliveryStatus({
      messageId: dto.internal_message_id ?? null,
      providerMessageId: dto.provider_message_id,
      deliveryStatus: dto.status,
      correlationId,
    });
    return { id: updated.id, status: updated.deliveryStatus };
  }
}
