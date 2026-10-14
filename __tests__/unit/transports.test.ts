import type { RealtimePublisher } from '../../dist/adapter/realtime/realtime.port.js';
import './chat-fixtures.ts';
import {
  dependency,
  conversation,
  conversationModel,
  message,
  messageModel,
  realtimeEvent,
  TENANT,
  USER,
  PEER,
  NOW,
  ConversationType,
} from './chat-fixtures.ts';
import { HttpException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { Test } from '@nestjs/testing';
import { ContextAccessor } from '@omnixys/context-ts';
import { PrincipalType } from '@omnixys/contracts-ts';
import assert from 'node:assert/strict';
import test, { mock, type Mock } from 'node:test';
import { Subject, firstValueFrom } from 'rxjs';
const { REALTIME_PUBLISHER } =
  await import('../../dist/adapter/realtime/realtime.port.js');
const { ChatResolver } =
  await import('../../dist/chat/resolvers/chat.resolver.js');
const { GraphqlChatReadService } =
  await import('../../dist/chat/services/graphql-chat-read.service.js');
const { GraphqlChatWriteService } =
  await import('../../dist/chat/services/graphql-chat-write.service.js');
const { ConversationReadService } =
  await import('../../dist/chat/services/conversation-read.service.js');
const { MessageReadService } =
  await import('../../dist/chat/services/message-read.service.js');
import type { InboundMessageService } from '../../dist/chat/services/inbound-message.service.js';
import type { MessageWriteService } from '../../dist/chat/services/message-write.service.js';
const { InternalChatController } =
  await import('../../dist/chat/controllers/internal.controller.js');
const { InternalApiKeyGuard } =
  await import('../../dist/chat/controllers/internal-api-key.guard.js');
const context = {
  tenant: { tenantId: TENANT, verified: true, source: 'principal' as const },
  principal: {
    principalType: PrincipalType.USER,
    userId: USER,
    subject: 'keycloak-opaque-sub',
    actorId: USER,
    roles: [],
    tenantId: TENANT,
  },
  correlationId: 'correlation-1',
};
interface ResolverHarness {
  resolver: InstanceType<typeof ChatResolver>;
  close: () => Promise<void>;
  read: {
    conversations: Mock<
      InstanceType<typeof GraphqlChatReadService>['conversations']
    >;
    conversation: Mock<
      InstanceType<typeof GraphqlChatReadService>['conversation']
    >;
    messages: Mock<InstanceType<typeof GraphqlChatReadService>['messages']>;
  };
  write: {
    createInAppConversation: Mock<
      InstanceType<typeof GraphqlChatWriteService>['createInAppConversation']
    >;
    createWhatsappConversation: Mock<
      InstanceType<typeof GraphqlChatWriteService>['createWhatsappConversation']
    >;
    sendMessage: Mock<
      InstanceType<typeof GraphqlChatWriteService>['sendMessage']
    >;
    markRead: Mock<InstanceType<typeof GraphqlChatWriteService>['markRead']>;
  };
  get: Mock<InstanceType<typeof ConversationReadService>['getForParticipant']>;
  count: Mock<InstanceType<typeof MessageReadService>['countUnread']>;
  subscribe: Mock<RealtimePublisher['subscribe']>;
  events: Subject<typeof realtimeEvent>;
}
async function resolverHarness(): Promise<ResolverHarness> {
  const read = {
    conversations: mock.fn<
      InstanceType<typeof GraphqlChatReadService>['conversations']
    >(async () => [conversationModel]),
    conversation: mock.fn<
      InstanceType<typeof GraphqlChatReadService>['conversation']
    >(async () => conversationModel),
    messages: mock.fn<InstanceType<typeof GraphqlChatReadService>['messages']>(
      async () => [messageModel],
    ),
  };
  const write = {
    createInAppConversation: mock.fn<
      InstanceType<typeof GraphqlChatWriteService>['createInAppConversation']
    >(async () => conversationModel),
    createWhatsappConversation: mock.fn<
      InstanceType<typeof GraphqlChatWriteService>['createWhatsappConversation']
    >(async () => conversationModel),
    sendMessage: mock.fn<
      InstanceType<typeof GraphqlChatWriteService>['sendMessage']
    >(async () => messageModel),
    markRead: mock.fn<InstanceType<typeof GraphqlChatWriteService>['markRead']>(
      async () => true,
    ),
  };
  const get = mock.fn<
    InstanceType<typeof ConversationReadService>['getForParticipant']
  >(async () => conversation);
  const count = mock.fn<InstanceType<typeof MessageReadService>['countUnread']>(
    async () => 7,
  );
  const events = new Subject<typeof realtimeEvent>();
  const subscribe = mock.fn<RealtimePublisher['subscribe']>(() =>
    events.asObservable(),
  );
  const module = await Test.createTestingModule({
    providers: [
      ChatResolver,
      { provide: GraphqlChatReadService, useValue: read },
      { provide: GraphqlChatWriteService, useValue: write },
      {
        provide: ConversationReadService,
        useValue: { getForParticipant: get },
      },
      { provide: MessageReadService, useValue: { countUnread: count } },
      { provide: REALTIME_PUBLISHER, useValue: { subscribe } },
    ],
  }).compile();
  return {
    resolver: module.get(ChatResolver),
    close: async () => module.close(),
    read,
    write,
    get,
    count,
    subscribe,
    events,
  };
}
const operations = [
  'listConversations',
  'getConversation',
  'listMessages',
  'createInAppConversation',
  'createWhatsappConversation',
  'sendMessage',
  'markRead',
  'unreadCount',
] as const;
function invoke(
  h: ResolverHarness,
  operation: (typeof operations)[number],
): Promise<unknown> {
  switch (operation) {
    case 'listConversations':
      return h.resolver.listConversations();
    case 'getConversation':
      return h.resolver.getConversation(conversation.id);
    case 'listMessages':
      return h.resolver.listMessages(conversation.id, 17, NOW, message.id);
    case 'createInAppConversation':
      return h.resolver.createInAppConversation(PEER, ConversationType.SUPPORT);
    case 'createWhatsappConversation':
      return h.resolver.createWhatsappConversation('+49301234567', 'Ada');
    case 'sendMessage':
      return h.resolver.sendMessage(conversation.id, 'Hello', 'IMAGE');
    case 'markRead':
      return h.resolver.markRead(conversation.id, NOW, message.id);
    case 'unreadCount':
      return h.resolver.unreadCount(conversationModel);
  }
}
// @covers ChatResolver.listConversations
// @covers ChatResolver.getConversation
// @covers ChatResolver.listMessages
// @covers ChatResolver.createInAppConversation
// @covers ChatResolver.createWhatsappConversation
// @covers ChatResolver.sendMessage
// @covers ChatResolver.markRead
// @covers ChatResolver.unreadCount
for (const operation of operations) {
  await test(`resolver ${operation} forwards canonical tenant/user, arguments and result`, async () => {
    const h = await resolverHarness();
    try {
      const result = await ContextAccessor.run(context, () =>
        invoke(h, operation),
      );
      const [port, args, expected] =
        operation === 'listConversations'
          ? [h.read.conversations, [TENANT, USER], [conversationModel]]
          : operation === 'getConversation'
            ? [
                h.read.conversation,
                [TENANT, USER, conversation.id],
                conversationModel,
              ]
            : operation === 'listMessages'
              ? [
                  h.read.messages,
                  [TENANT, USER, conversation.id, 17, NOW, message.id],
                  [messageModel],
                ]
              : operation === 'createInAppConversation'
                ? [
                    h.write.createInAppConversation,
                    [TENANT, USER, PEER, ConversationType.SUPPORT],
                    conversationModel,
                  ]
                : operation === 'createWhatsappConversation'
                  ? [
                      h.write.createWhatsappConversation,
                      [TENANT, USER, '+49301234567', 'Ada'],
                      conversationModel,
                    ]
                  : operation === 'sendMessage'
                    ? [
                        h.write.sendMessage,
                        [
                          TENANT,
                          USER,
                          conversation.id,
                          'Hello',
                          'IMAGE',
                          'correlation-1',
                        ],
                        messageModel,
                      ]
                    : operation === 'markRead'
                      ? [
                          h.write.markRead,
                          [TENANT, USER, conversation.id, NOW, message.id],
                          true,
                        ]
                      : [h.count, [TENANT, USER, conversation.id], 7];
      assert.deepEqual(result, expected);
      assert.deepEqual(
        (port as Mock<(...args: unknown[]) => unknown>).mock.calls[0]
          ?.arguments,
        args,
      );
    } finally {
      await h.close();
    }
  });
  await test(`resolver ${operation} preserves application failure`, async () => {
    const h = await resolverHarness();
    try {
      const cause = new Error('application failed');
      const port =
        operation === 'listConversations'
          ? h.read.conversations
          : operation === 'getConversation'
            ? h.read.conversation
            : operation === 'listMessages'
              ? h.read.messages
              : operation === 'createInAppConversation'
                ? h.write.createInAppConversation
                : operation === 'createWhatsappConversation'
                  ? h.write.createWhatsappConversation
                  : operation === 'sendMessage'
                    ? h.write.sendMessage
                    : operation === 'markRead'
                      ? h.write.markRead
                      : h.count;
      port.mock.mockImplementationOnce(async () => {
        throw cause;
      });
      await assert.rejects(
        ContextAccessor.run(context, () => invoke(h, operation)),
        cause,
      );
    } finally {
      await h.close();
    }
  });
  for (const invalid of [
    'no-tenant',
    'unverified',
    'malformed-tenant',
    'mismatch',
    'no-user',
    'service-principal',
  ] as const) {
    await test(`resolver ${operation} denies ${invalid} before accessing services`, async () => {
      const h = await resolverHarness();
      try {
        const input =
          invalid === 'no-tenant'
            ? { ...context, tenant: undefined }
            : invalid === 'unverified'
              ? { ...context, tenant: { ...context.tenant, verified: false } }
              : invalid === 'malformed-tenant'
                ? {
                    ...context,
                    tenant: { ...context.tenant, tenantId: 'malformed' },
                  }
                : invalid === 'mismatch'
                  ? {
                      ...context,
                      principal: {
                        ...context.principal,
                        tenantId: 'other-tenant',
                      },
                    }
                  : invalid === 'no-user'
                    ? { ...context, principal: undefined }
                    : {
                        ...context,
                        principal: {
                          ...context.principal,
                          principalType: PrincipalType.SERVICE,
                          userId: undefined,
                        },
                      };
        assert.throws(
          () => ContextAccessor.run(input, () => invoke(h, operation)),
          {
            code:
              invalid === 'no-user' || invalid === 'service-principal'
                ? 'UNAUTHORIZED'
                : 'TENANT_CONTEXT_UNVERIFIED',
          },
        );
        for (const port of [
          ...Object.values(h.read),
          ...Object.values(h.write),
          h.count,
          h.get,
          h.subscribe,
        ]) {
          assert.equal(port.mock.callCount(), 0);
        }
      } finally {
        await h.close();
      }
    });
  }
}
// @covers ChatResolver.messageReceived
await test('message subscription waits for participant authorization, projects events and tears down observable listeners', async () => {
  const h = await resolverHarness();
  try {
    const permission = Promise.withResolvers<typeof conversation>();
    const attached = Promise.withResolvers<void>();
    h.get.mock.mockImplementationOnce(async () => permission.promise);
    h.subscribe.mock.mockImplementationOnce(() => {
      attached.resolve();
      return h.events.asObservable();
    });
    const stream = ContextAccessor.run(context, () =>
      h.resolver.messageReceived(conversation.id),
    );
    const result = firstValueFrom(stream);
    assert.equal(h.subscribe.mock.callCount(), 0);
    permission.resolve(conversation);
    await attached.promise;
    assert.deepEqual(h.get.mock.calls[0]?.arguments, [
      TENANT,
      USER,
      conversation.id,
    ]);
    assert.deepEqual(h.subscribe.mock.calls[0]?.arguments, [
      `conversation:${conversation.id}`,
    ]);
    h.events.next(realtimeEvent);
    assert.deepEqual(await result, messageModel);
    assert.equal(h.events.observed, false);
  } finally {
    await h.close();
  }
});
await test('denied message subscription propagates access failure without attaching realtime', async () => {
  const h = await resolverHarness();
  try {
    const cause = new Error('denied');
    h.get.mock.mockImplementationOnce(async () => {
      throw cause;
    });
    const stream = ContextAccessor.run(context, () =>
      h.resolver.messageReceived(conversation.id),
    );
    await assert.rejects(firstValueFrom(stream), cause);
    assert.equal(h.subscribe.mock.callCount(), 0);
  } finally {
    await h.close();
  }
});
// @covers ChatResolver.conversationUpdated
await test('conversation update captures canonical identity, rereads the authorized conversation and projects it', async () => {
  const h = await resolverHarness();
  try {
    const stream = ContextAccessor.run(context, () =>
      h.resolver.conversationUpdated(),
    );
    const result = firstValueFrom(stream);
    h.events.next(realtimeEvent);
    assert.deepEqual(await result, conversationModel);
    assert.deepEqual(h.subscribe.mock.calls[0]?.arguments, [`user:${USER}`]);
    assert.deepEqual(h.get.mock.calls[0]?.arguments, [
      TENANT,
      USER,
      conversation.id,
    ]);
    assert.equal(h.events.observed, false);
  } finally {
    await h.close();
  }
});
await test('conversation update denies a now-inaccessible conversation and closes the stream', async () => {
  const h = await resolverHarness();
  try {
    const cause = new Error('no longer participant');
    h.get.mock.mockImplementationOnce(async () => {
      throw cause;
    });
    const result = firstValueFrom(
      ContextAccessor.run(context, () => h.resolver.conversationUpdated()),
    );
    const rejected = assert.rejects(result, cause);
    h.events.next(realtimeEvent);
    await rejected;
    assert.equal(h.events.observed, false);
  } finally {
    await h.close();
  }
});
for (const subscription of [
  'messageReceived',
  'conversationUpdated',
] as const) {
  await test(`${subscription} refuses missing verified identity before opening stream`, async () => {
    const h = await resolverHarness();
    try {
      assert.throws(
        () =>
          ContextAccessor.run({}, () =>
            subscription === 'messageReceived'
              ? h.resolver.messageReceived(conversation.id)
              : h.resolver.conversationUpdated(),
          ),
        { code: 'TENANT_CONTEXT_UNVERIFIED' },
      );
      assert.equal(h.subscribe.mock.callCount(), 0);
      assert.equal(h.get.mock.callCount(), 0);
    } finally {
      await h.close();
    }
  });
}
// @covers InternalChatController.verifyParticipant
// @covers InternalChatController.inboundMessage
// @covers InternalChatController.deliveryStatus
await test('internal controller maps inbound field names, default values and UTC response without accepting caller tenant', async () => {
  const handle = mock.fn<InboundMessageService['handle']>(async () => ({
    message,
    duplicate: false,
    tenantId: TENANT,
  }));
  const controller = new InternalChatController(
    dependency<InstanceType<typeof ConversationReadService>>({}),
    dependency<InboundMessageService>({ handle }),
    dependency<MessageWriteService>({}),
  );
  assert.deepEqual(
    await controller.inboundMessage({
      message_id: 'provider-1',
      channel: 'WHATSAPP',
      senderAddress: '',
    }),
    {
      id: message.id,
      conversation_id: conversation.id,
      sender_id: USER,
      body: message.body,
      channel: message.channel,
      delivery_status: message.deliveryStatus,
      created_at: NOW.toISOString(),
      duplicate: false,
    },
  );
  assert.deepEqual(handle.mock.calls[0]?.arguments, [
    {
      messageId: 'provider-1',
      channel: 'WHATSAPP',
      userId: '',
      from: '',
      body: '',
      contentType: 'TEXT',
      conversationId: null,
    },
  ]);
});
await test('internal delivery callback forwards correlation and references and returns stored status', async () => {
  const applyDeliveryStatus = mock.fn<
    MessageWriteService['applyDeliveryStatus']
  >(async () => message);
  const controller = new InternalChatController(
    dependency<InstanceType<typeof ConversationReadService>>({}),
    dependency<InboundMessageService>({}),
    dependency<MessageWriteService>({
      applyDeliveryStatus,
    }),
  );
  assert.deepEqual(
    await ContextAccessor.run(context, () =>
      controller.deliveryStatus({
        internal_message_id: message.id,
        provider_message_id: 'provider-1',
        status: 'SENT',
      }),
    ),
    { id: message.id, status: message.deliveryStatus },
  );
  assert.deepEqual(applyDeliveryStatus.mock.calls[0]?.arguments, [
    {
      messageId: message.id,
      providerMessageId: 'provider-1',
      deliveryStatus: 'SENT',
      correlationId: 'correlation-1',
    },
  ]);
});
for (const outcome of ['allowed', 'forbidden', 'not-found'] as const) {
  await test(`internal participant controller maps ${outcome}`, async () => {
    const checkParticipantAccess = mock.fn<
      InstanceType<typeof ConversationReadService>['checkParticipantAccess']
    >(async () => outcome);
    const controller = new InternalChatController(
      dependency<InstanceType<typeof ConversationReadService>>({
        checkParticipantAccess,
      }),
      dependency<InboundMessageService>({}),
      dependency<MessageWriteService>({}),
    );
    const result = controller.verifyParticipant(conversation.id, USER);
    if (outcome === 'allowed') {
      assert.equal(await result, undefined);
    } else {
      await assert.rejects(result, (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), outcome === 'forbidden' ? 403 : 404);
        assert.deepEqual(error.getResponse(), {
          code:
            outcome === 'forbidden'
              ? 'CONVERSATION_ACCESS_DENIED'
              : 'CONVERSATION_NOT_FOUND',
        });
        return true;
      });
    }
    assert.deepEqual(checkParticipantAccess.mock.calls[0]?.arguments, [
      conversation.id,
      USER,
    ]);
  });
}
for (const method of ['participant', 'inbound', 'delivery'] as const) {
  await test(`internal ${method} service failure remains observable`, async () => {
    const cause = new Error('service failed');
    const checkParticipantAccess = async (): Promise<'allowed'> => {
      throw cause;
    };
    const handle = async (): Promise<never> => {
      throw cause;
    };
    const applyDeliveryStatus = async (): Promise<never> => {
      throw cause;
    };
    const controller = new InternalChatController(
      dependency<InstanceType<typeof ConversationReadService>>({
        checkParticipantAccess,
      }),
      dependency<InboundMessageService>({ handle }),
      dependency<MessageWriteService>({
        applyDeliveryStatus,
      }),
    );
    await assert.rejects(
      method === 'participant'
        ? controller.verifyParticipant(conversation.id, USER)
        : method === 'inbound'
          ? controller.inboundMessage({
              message_id: 'provider-1',
              channel: 'WHATSAPP',
              senderAddress: '',
            })
          : controller.deliveryStatus({
              status: 'SENT',
              provider_message_id: 'provider-1',
            }),
      cause,
    );
  });
}
// @covers InternalApiKeyGuard.canActivate
for (const value of [
  '',
  [],
  ['wrong', 'chat-unit-internal-key'],
  'ä'.repeat(22),
  ' chat-unit-internal-key ',
]) {
  await test('internal key guard rejects empty/repeated-spoofed/multibyte/untrimmed keys', () => {
    const host = new ExecutionContextHost([
      { headers: { 'x-api-key': value } },
    ]);
    assert.throws(
      () => new InternalApiKeyGuard().canActivate(host),
      (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 401);
        return true;
      },
    );
  });
}
