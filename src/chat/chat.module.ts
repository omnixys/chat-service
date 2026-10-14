/**
 * @license GPL-3.0-or-later
 * Copyright (C) 2025 Caleb Gyamfi - Omnixys Technologies
 */

import { ChatAdaptersModule } from '../adapter/chat-adapters.module.js';
import { InternalApiKeyGuard } from './controllers/internal-api-key.guard.js';
import { InternalChatController } from './controllers/internal.controller.js';
import { PrismaUnitOfWork, UNIT_OF_WORK_PROVIDER } from './persistence/prisma-unit-of-work.js';
import { ChatResolver } from './resolvers/chat.resolver.js';
import { ConversationReadService } from './services/conversation-read.service.js';
import { ConversationWriteService } from './services/conversation-write.service.js';
import { GraphqlChatReadService } from './services/graphql-chat-read.service.js';
import { GraphqlChatWriteService } from './services/graphql-chat-write.service.js';
import { InboundMessageService } from './services/inbound-message.service.js';
import { MessageDispatcher } from './services/message-dispatcher.service.js';
import { MessageReadService } from './services/message-read.service.js';
import { MessageWriteService } from './services/message-write.service.js';
import { ReadStateService } from './services/read-state.service.js';
import { Module } from '@nestjs/common';

/** One chat context with shared application services for both API transports. */
@Module({
  imports: [ChatAdaptersModule],
  controllers: [InternalChatController],
  providers: [
    PrismaUnitOfWork,
    UNIT_OF_WORK_PROVIDER,
    ConversationReadService,
    ConversationWriteService,
    MessageReadService,
    MessageWriteService,
    MessageDispatcher,
    ReadStateService,
    InboundMessageService,
    GraphqlChatReadService,
    GraphqlChatWriteService,
    ChatResolver,
    InternalApiKeyGuard,
  ],
})
export class ChatModule {}
