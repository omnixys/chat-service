import type { AnalyticsFactWriter } from '../../dist/analytics/analytics.port.js';
import type { ConversationRepository } from '../../dist/chat/ports/conversation.repository.port.js';
import type {
  MessageRepository,
  ReadStateRepository,
} from '../../dist/chat/ports/message.repository.port.js';
import type {
  UnitOfWork,
  UnitOfWorkContext,
} from '../../dist/chat/ports/unit-of-work.port.js';
import {
  conversation,
  message,
  NOW,
  TENANT,
  USER,
  PEER,
} from './chat-fixtures.ts';
import { mock, type Mock } from 'node:test';
type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown
    ? Mock<T[K]>
    : T[K];
};
export interface ServiceHarness {
  unitOfWork: UnitOfWork;
  transaction: Mock<
    (work: (context: UnitOfWorkContext) => Promise<unknown>) => Promise<unknown>
  >;
  conversations: Mocked<ConversationRepository>;
  messages: Mocked<MessageRepository>;
  readStates: Mocked<ReadStateRepository>;
  analytics: Mocked<AnalyticsFactWriter>;
}
export function serviceHarness(): ServiceHarness {
  const conversations: Mocked<ConversationRepository> = {
    findById: mock.fn<ConversationRepository['findById']>(
      async () => conversation,
    ),
    findByIdAnyTenant: mock.fn<ConversationRepository['findByIdAnyTenant']>(
      async () => conversation,
    ),
    findByParticipantPairKey: mock.fn<
      ConversationRepository['findByParticipantPairKey']
    >(async () => null),
    findByUserId: mock.fn<ConversationRepository['findByUserId']>(async () => [
      conversation,
    ]),
    findByExternalAddress: mock.fn<
      ConversationRepository['findByExternalAddress']
    >(async () => null),
    findByExternalAddressAnyTenant: mock.fn<
      ConversationRepository['findByExternalAddressAnyTenant']
    >(async () => [conversation]),
    save: mock.fn<ConversationRepository['save']>(async (_tenant, row) => row),
    addParticipant: mock.fn<ConversationRepository['addParticipant']>(
      async () => {},
    ),
    isParticipant: mock.fn<ConversationRepository['isParticipant']>(
      async () => true,
    ),
    getParticipantIds: mock.fn<ConversationRepository['getParticipantIds']>(
      async () => [USER, PEER],
    ),
    touch: mock.fn<ConversationRepository['touch']>(async () => {}),
  };
  const messages: Mocked<MessageRepository> = {
    findByConversation: mock.fn<MessageRepository['findByConversation']>(
      async () => [message],
    ),
    save: mock.fn<MessageRepository['save']>(async (_tenant, row) => row),
    findById: mock.fn<MessageRepository['findById']>(async () => message),
    findByIdAnyTenant: mock.fn<MessageRepository['findByIdAnyTenant']>(
      async () => message,
    ),
    findByProviderMessageIdAnyTenant: mock.fn<
      MessageRepository['findByProviderMessageIdAnyTenant']
    >(async () => []),
    findByIdInConversation: mock.fn<
      MessageRepository['findByIdInConversation']
    >(async () => true),
    countUnread: mock.fn<MessageRepository['countUnread']>(async () => 3),
    getLastMessage: mock.fn<MessageRepository['getLastMessage']>(
      async () => message,
    ),
    updateDeliveryStatus: mock.fn<MessageRepository['updateDeliveryStatus']>(
      async (_tenant, _id, status, providerId) => ({
        ...message,
        deliveryStatus: status,
        providerMessageId: providerId ?? message.providerMessageId,
      }),
    ),
  };
  const readStates: Mocked<ReadStateRepository> = {
    find: mock.fn<ReadStateRepository['find']>(async () => null),
    upsert: mock.fn<ReadStateRepository['upsert']>(async (tenantId, state) => ({
      id: 'read-state-1',
      tenantId,
      ...state,
    })),
  };
  const analytics: Mocked<AnalyticsFactWriter> = {
    enqueue: mock.fn<AnalyticsFactWriter['enqueue']>(async () => 'fact-1'),
  };
  const context: UnitOfWorkContext = {
    conversationRepository: conversations,
    messageRepository: messages,
    readStateRepository: readStates,
    analytics,
  };
  const transaction = mock.fn(
    async (
      work: (context: UnitOfWorkContext) => Promise<unknown>,
    ): Promise<unknown> => work(context),
  );
  const unitOfWork: UnitOfWork = {
    transaction: transaction as UnitOfWork['transaction'],
  };
  return {
    unitOfWork,
    transaction,
    conversations,
    messages,
    readStates,
    analytics,
  };
}
export const readState = {
  id: 'read-state-1',
  tenantId: TENANT,
  conversationId: conversation.id,
  userId: USER,
  lastReadAt: NOW,
  lastReadMessageId: message.id,
};
