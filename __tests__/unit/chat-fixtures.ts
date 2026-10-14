import type { Conversation } from '../../dist/chat/models/entities/conversation.model.js';
import type { Message } from '../../dist/chat/models/entities/message.model.js';
import type { OmnixysLogger } from '@omnixys/logger-ts';
process.env.DOTENV_CONFIG_PATH = '/dev/null';
Object.assign(process.env, {
  NODE_ENV: 'test',
  HTTPS: 'false',
  SERVICE: 'chat-unit',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/unit',
  VALKEY_URL: 'valkey://127.0.0.1:1',
  KAFKA_BROKER: '127.0.0.1:1',
  GATEWAY_BASE_URL: 'http://gateway.test///',
  GATEWAY_API_KEY: 'chat-unit-gateway-key',
  GATEWAY_TIMEOUT: '17000',
  INTERNAL_GATEWAY_TOKEN: 'chat-unit-internal-key',
  KEYCLOAK_HEALTH_URL: '',
  PROMETHEUS_HEALTH_URL: '',
  ANALYTICS_OUTBOX_ENABLED: 'true',
  ANALYTICS_OUTBOX_INTERVAL_MS: '10000',
  ANALYTICS_OUTBOX_BATCH_SIZE: '7',
  ANALYTICS_OUTBOX_MAX_ATTEMPTS: '3',
});
export const { ChannelType, ConversationType } =
  await import('../../dist/chat/models/enums/conversation.enums.js');
export const { DeliveryStatus } =
  await import('../../dist/chat/models/enums/message.enums.js');
export const NOW = new Date('2026-10-03T10:00:00Z');
export const TENANT = '22222222-2222-4222-8222-222222222222';
export const USER = '019a08da-6000-7000-8000-000000000001';
export const PEER = '019a08da-6000-7000-8000-000000000002';
export const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
export const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
export const conversation: Conversation = {
  id: CONVERSATION_ID,
  tenantId: TENANT,
  type: ConversationType.DIRECT,
  participantPairKey: [USER, PEER].sort().join(':'),
  channel: ChannelType.IN_APP,
  externalAddress: null,
  externalDisplayName: null,
  createdAt: NOW,
  updatedAt: NOW,
  participantIds: [USER, PEER],
  lastMessage: null,
  lastMessageAt: null,
};
export const message: Message = {
  id: MESSAGE_ID,
  tenantId: TENANT,
  conversationId: CONVERSATION_ID,
  senderId: USER,
  body: 'Hello',
  contentType: 'TEXT',
  channel: ChannelType.IN_APP,
  deliveryStatus: DeliveryStatus.PENDING,
  providerMessageId: null,
  createdAt: NOW,
  editedAt: null,
  deletedAt: null,
};
export function dependency<T>(value: Partial<T>): T {
  return value as T;
}
export const logger = dependency<OmnixysLogger>({
  log: () =>
    dependency<ReturnType<OmnixysLogger['log']>>({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }),
});

export const conversationModel = {
  id: conversation.id,
  type: conversation.type,
  channel: conversation.channel,
  participants: [{ userId: USER }, { userId: PEER }],
  externalAddress: null,
  externalDisplayName: null,
  lastMessage: null,
  lastMessageAt: null,
  unreadCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
};
export const messageModel = {
  id: message.id,
  conversationId: conversation.id,
  senderId: USER,
  body: message.body,
  contentType: message.contentType,
  channel: message.channel,
  deliveryStatus: message.deliveryStatus,
  createdAt: NOW,
  editedAt: null,
  deletedAt: null,
};
export const realtimeEvent = {
  messageId: message.id,
  conversationId: conversation.id,
  senderId: USER,
  body: message.body,
  contentType: message.contentType,
  channel: message.channel,
  deliveryStatus: message.deliveryStatus,
  createdAt: NOW.toISOString(),
};
