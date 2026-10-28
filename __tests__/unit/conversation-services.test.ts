import './chat-fixtures.ts';
import {
  conversation,
  message,
  TENANT,
  USER,
  PEER,
  NOW,
  logger,
  ConversationType,
} from './chat-fixtures.ts';
import { serviceHarness, readState } from './service-fixtures.ts';
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
const crypto = await import('node:crypto');
const { default: cryptoDefault, ...cryptoExports } = crypto;
const fixedUUID = (): string => '55555555-5555-4555-8555-555555555555';
mock.module('node:crypto', {
  namedExports: { ...cryptoExports, randomUUID: fixedUUID },
  defaultExport: { ...cryptoDefault, randomUUID: fixedUUID },
});
const { ConversationReadService } =
  await import('../../dist/chat/services/conversation-read.service.js');
const { ConversationWriteService } =
  await import('../../dist/chat/services/conversation-write.service.js');
const { MessageReadService } =
  await import('../../dist/chat/services/message-read.service.js');
const { ReadStateService } =
  await import('../../dist/chat/services/read-state.service.js');
// @covers ConversationReadService.listForUser
await test('conversation list preserves tenant/user scope and empty result', async () => {
  const h = serviceHarness();
  h.conversations.findByUserId.mock.mockImplementationOnce(async () => []);
  assert.deepEqual(
    await new ConversationReadService(h.unitOfWork).listForUser(TENANT, USER),
    [],
  );
  assert.deepEqual(h.conversations.findByUserId.mock.calls[0]?.arguments, [
    TENANT,
    USER,
  ]);
});
await test('conversation list repository failure remains observable', async () => {
  const h = serviceHarness();
  const cause = new Error('lookup failed');
  h.conversations.findByUserId.mock.mockImplementationOnce(async () => {
    throw cause;
  });
  await assert.rejects(
    new ConversationReadService(h.unitOfWork).listForUser(TENANT, USER),
    cause,
  );
});
// @covers ConversationReadService.getForParticipant
await test('participant read hides existence before looking up an inaccessible conversation', async () => {
  const h = serviceHarness();
  h.conversations.isParticipant.mock.mockImplementationOnce(async () => false);
  await assert.rejects(
    new ConversationReadService(h.unitOfWork).getForParticipant(
      TENANT,
      USER,
      conversation.id,
    ),
    { code: 'CONVERSATION_NOT_FOUND' },
  );
  assert.equal(h.conversations.findById.mock.callCount(), 0);
});
await test('participant read still rejects a missing row after successful membership check', async () => {
  const h = serviceHarness();
  h.conversations.findById.mock.mockImplementationOnce(async () => null);
  await assert.rejects(
    new ConversationReadService(h.unitOfWork).getForParticipant(
      TENANT,
      USER,
      conversation.id,
    ),
    { code: 'CONVERSATION_NOT_FOUND' },
  );
});
// @covers ConversationReadService.checkParticipantAccess
await test('internal participant lookup derives tenant from the resolved conversation', async () => {
  const h = serviceHarness();
  const service = new ConversationReadService(h.unitOfWork);
  assert.equal(
    await service.checkParticipantAccess(conversation.id, USER),
    'allowed',
  );
  assert.deepEqual(h.conversations.isParticipant.mock.calls[0]?.arguments, [
    TENANT,
    conversation.id,
    USER,
  ]);
  h.conversations.isParticipant.mock.mockImplementationOnce(async () => false);
  assert.equal(
    await service.checkParticipantAccess(conversation.id, PEER),
    'forbidden',
  );
  h.conversations.findByIdAnyTenant.mock.mockImplementationOnce(
    async () => null,
  );
  assert.equal(
    await service.checkParticipantAccess('unknown', USER),
    'not-found',
  );
  assert.equal(h.conversations.isParticipant.mock.callCount(), 2);
});
// @covers ConversationWriteService.createDirectConversation
await test('support creation uses a separate namespace and writes participants plus outbox in the same transaction', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const h = serviceHarness();
  const result = await new ConversationWriteService(
    h.unitOfWork,
    logger,
  ).createDirectConversation(TENANT, USER, PEER, ConversationType.SUPPORT);
  assert.equal(result.id, '55555555-5555-4555-8555-555555555555');
  assert.deepEqual(result.createdAt, NOW);
  assert.deepEqual(result.updatedAt, NOW);
  assert.equal(
    result.participantPairKey,
    `support:${[USER, PEER].sort().join(':')}`,
  );
  assert.deepEqual(
    h.conversations.addParticipant.mock.calls.map((call) => call.arguments),
    [
      [TENANT, result.id, USER],
      [TENANT, result.id, PEER],
    ],
  );
  assert.deepEqual(h.analytics.enqueue.mock.calls[0]?.arguments, [
    {
      topic: 'chat.conversation.created.v1',
      eventName: 'conversation.created',
      aggregateId: result.id,
      aggregateType: 'chat.conversation',
      subjectId: USER,
      actorId: USER,
      tenantId: TENANT,
      properties: {
        type: ConversationType.SUPPORT,
        channel: result.channel,
        participantCount: 2,
      },
    },
  ]);
  assert.equal(h.transaction.mock.callCount(), 1);
});
for (const [actor, participant] of [
  [USER, USER],
  ['', USER],
  [USER, ''],
]) {
  await test(`direct invalid participant pair ${actor}/${participant} stops before persistence`, async () => {
    const h = serviceHarness();
    await assert.rejects(
      new ConversationWriteService(
        h.unitOfWork,
        logger,
      ).createDirectConversation(
        TENANT,
        actor as string,
        participant as string,
      ),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.transaction.mock.callCount(), 0);
  });
}
await test('unsupported in-app conversation type is rejected without a transaction', async () => {
  const h = serviceHarness();
  await assert.rejects(
    new ConversationWriteService(h.unitOfWork, logger).createDirectConversation(
      TENANT,
      USER,
      PEER,
      'UNSUPPORTED' as typeof ConversationType.DIRECT,
    ),
    { code: 'MESSAGE_INPUT_INVALID' },
  );
  assert.equal(h.transaction.mock.callCount(), 0);
});
await test('direct P2002 creation race rereads the winner in a fresh transaction and does not duplicate facts', async () => {
  const h = serviceHarness();
  const cause = Object.assign(new Error('unique race'), { code: 'P2002' });
  h.conversations.save.mock.mockImplementationOnce(async () => {
    throw cause;
  });
  h.conversations.findByParticipantPairKey.mock.mockImplementationOnce(
    async () => null,
  );
  h.conversations.findByParticipantPairKey.mock.mockImplementationOnce(
    async () => conversation,
    1,
  );
  assert.equal(
    await new ConversationWriteService(
      h.unitOfWork,
      logger,
    ).createDirectConversation(TENANT, USER, PEER),
    conversation,
  );
  assert.equal(h.transaction.mock.callCount(), 2);
  assert.equal(h.analytics.enqueue.mock.callCount(), 0);
  assert.equal(h.conversations.addParticipant.mock.callCount(), 0);
});
await test('unique race without a visible winner rethrows the original failure', async () => {
  const h = serviceHarness();
  const cause = Object.assign(new Error('unique race'), { code: 'P2002' });
  h.conversations.save.mock.mockImplementationOnce(async () => {
    throw cause;
  });
  await assert.rejects(
    new ConversationWriteService(h.unitOfWork, logger).createDirectConversation(
      TENANT,
      USER,
      PEER,
    ),
    cause,
  );
});
for (const stage of ['save', 'participant', 'outbox'] as const) {
  await test(`direct ${stage} failure propagates rather than treating it as a unique race`, async () => {
    const h = serviceHarness();
    const cause = new Error(`${stage} failed`);
    const port =
      stage === 'save'
        ? h.conversations.save
        : stage === 'participant'
          ? h.conversations.addParticipant
          : h.analytics.enqueue;
    port.mock.mockImplementationOnce(async () => {
      throw cause;
    });
    await assert.rejects(
      new ConversationWriteService(
        h.unitOfWork,
        logger,
      ).createDirectConversation(TENANT, USER, PEER),
      cause,
    );
    assert.equal(h.transaction.mock.callCount(), 1);
  });
}
// @covers ConversationWriteService.createWhatsappConversation
for (const phone of ['invalid', '+0', '+4930letters']) {
  await test(`WhatsApp malformed address ${phone} cannot reach persistence`, async () => {
    const h = serviceHarness();
    await assert.rejects(
      new ConversationWriteService(
        h.unitOfWork,
        logger,
      ).createWhatsappConversation(TENANT, USER, phone, null),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.transaction.mock.callCount(), 0);
  });
}
await test('WhatsApp missing owner is rejected before persistence', async () => {
  const h = serviceHarness();
  await assert.rejects(
    new ConversationWriteService(
      h.unitOfWork,
      logger,
    ).createWhatsappConversation(TENANT, '', '+49301234567', null),
    { code: 'MESSAGE_INPUT_INVALID' },
  );
  assert.equal(h.transaction.mock.callCount(), 0);
});
for (const display of [null, '', '   ', '  Ada  ']) {
  await test(`WhatsApp display name ${JSON.stringify(display)} is normalized and owner participates`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
    const h = serviceHarness();
    const result = await new ConversationWriteService(
      h.unitOfWork,
      logger,
    ).createWhatsappConversation(TENANT, USER, ' +49301234567 ', display);
    assert.equal(result.externalAddress, '+49301234567');
    assert.equal(
      result.externalDisplayName,
      display?.trim() ? display.trim() : null,
    );
    assert.deepEqual(result.participantIds, [USER]);
    assert.equal(h.analytics.enqueue.mock.callCount(), 1);
  });
}
await test('WhatsApp unique race checks winner ownership instead of letting a second user take over', async () => {
  const h = serviceHarness();
  const cause = Object.assign(new Error('unique race'), { code: 'P2002' });
  h.conversations.save.mock.mockImplementationOnce(async () => {
    throw cause;
  });
  h.conversations.findByExternalAddress.mock.mockImplementationOnce(
    async () => null,
  );
  h.conversations.findByExternalAddress.mock.mockImplementationOnce(
    async () => conversation,
    1,
  );
  h.conversations.isParticipant.mock.mockImplementationOnce(async () => false);
  await assert.rejects(
    new ConversationWriteService(
      h.unitOfWork,
      logger,
    ).createWhatsappConversation(TENANT, USER, '+49301234567', null),
    { code: 'MESSAGE_INPUT_INVALID' },
  );
  assert.equal(h.analytics.enqueue.mock.callCount(), 0);
  assert.equal(h.transaction.mock.callCount(), 3);
});
// @covers MessageReadService.listMessages
for (const [limit, before, beforeId, expected] of [
  [undefined, undefined, undefined, { limit: 50, cursor: null }],
  [
    1000,
    NOW,
    message.id,
    { limit: 200, cursor: { createdAt: NOW, id: message.id } },
  ],
  [42, null, null, { limit: 42, cursor: null }],
] as const) {
  await test(`message read forwards bounded page ${String(limit)} and cursor ${String(beforeId)}`, async () => {
    const h = serviceHarness();
    const result = await new MessageReadService(
      h.unitOfWork,
      logger,
    ).listMessages(TENANT, USER, conversation.id, { limit, before, beforeId });
    assert.deepEqual(result, [message]);
    assert.deepEqual(h.messages.findByConversation.mock.calls[0]?.arguments, [
      TENANT,
      conversation.id,
      expected,
    ]);
  });
}
for (const limit of [0, -1, -42, 1.5]) {
  await test(`message read rejects invalid page size ${String(limit)} before membership or persistence`, async () => {
    const h = serviceHarness();
    await assert.rejects(
      new MessageReadService(h.unitOfWork, logger).listMessages(
        TENANT,
        USER,
        conversation.id,
        { limit },
      ),
      { code: 'MESSAGE_INPUT_INVALID' },
    );
    assert.equal(h.conversations.isParticipant.mock.callCount(), 0);
    assert.equal(h.messages.findByConversation.mock.callCount(), 0);
  });
}
await test('message read denied membership never accesses the message page', async () => {
  const h = serviceHarness();
  h.conversations.isParticipant.mock.mockImplementationOnce(async () => false);
  await assert.rejects(
    new MessageReadService(h.unitOfWork, logger).listMessages(
      TENANT,
      USER,
      conversation.id,
      {},
    ),
    { code: 'CONVERSATION_NOT_FOUND' },
  );
  assert.equal(h.messages.findByConversation.mock.callCount(), 0);
});
// @covers MessageReadService.countUnread
await test('unread count uses the persisted read cursor in the same tenant', async () => {
  const h = serviceHarness();
  h.readStates.find.mock.mockImplementationOnce(async () => readState);
  assert.equal(
    await new MessageReadService(h.unitOfWork, logger).countUnread(
      TENANT,
      USER,
      conversation.id,
    ),
    3,
  );
  assert.deepEqual(h.messages.countUnread.mock.calls[0]?.arguments, [
    TENANT,
    conversation.id,
    USER,
    NOW,
  ]);
});
await test('unread count missing cursor passes null and denied membership stops cursor/count reads', async () => {
  const h = serviceHarness();
  const service = new MessageReadService(h.unitOfWork, logger);
  assert.equal(await service.countUnread(TENANT, USER, conversation.id), 3);
  assert.deepEqual(h.messages.countUnread.mock.calls[0]?.arguments, [
    TENANT,
    conversation.id,
    USER,
    null,
  ]);
  h.conversations.isParticipant.mock.mockImplementationOnce(async () => false);
  await assert.rejects(service.countUnread(TENANT, USER, conversation.id), {
    code: 'CONVERSATION_NOT_FOUND',
  });
  assert.equal(h.readStates.find.mock.callCount(), 1);
  assert.equal(h.messages.countUnread.mock.callCount(), 1);
});
// @covers ReadStateService.markRead
await test('markRead validates a referenced message within the caller conversation before using the stored cursor for unread count', async () => {
  const h = serviceHarness();
  h.readStates.upsert.mock.mockImplementationOnce(async () => ({
    ...readState,
    lastReadAt: new Date(NOW.getTime() + 1000),
  }));
  const result = await new ReadStateService(h.unitOfWork, logger).markRead(
    TENANT,
    conversation.id,
    USER,
    NOW,
    message.id,
  );
  assert.equal(result.unreadCount, 3);
  assert.deepEqual(h.messages.findByIdInConversation.mock.calls[0]?.arguments, [
    TENANT,
    conversation.id,
    message.id,
  ]);
  assert.deepEqual(h.messages.countUnread.mock.calls[0]?.arguments, [
    TENANT,
    conversation.id,
    USER,
    result.readState.lastReadAt,
  ]);
});
for (const stage of [
  'cursor',
  'membership',
  'conversation',
  'message',
] as const) {
  await test(`markRead rejects invalid ${stage} before changing the cursor`, async () => {
    const h = serviceHarness();
    if (stage === 'membership') {
      h.conversations.isParticipant.mock.mockImplementationOnce(
        async () => false,
      );
    }
    if (stage === 'conversation') {
      h.conversations.findById.mock.mockImplementationOnce(async () => null);
    }
    if (stage === 'message') {
      h.messages.findByIdInConversation.mock.mockImplementationOnce(
        async () => false,
      );
    }
    await assert.rejects(
      new ReadStateService(h.unitOfWork, logger).markRead(
        TENANT,
        conversation.id,
        USER,
        stage === 'cursor' ? null : NOW,
        stage === 'cursor' ? null : message.id,
      ),
      {
        code:
          stage === 'membership' || stage === 'conversation'
            ? 'CONVERSATION_NOT_FOUND'
            : 'MESSAGE_INPUT_INVALID',
      },
    );
    assert.equal(h.readStates.upsert.mock.callCount(), 0);
  });
}
await test('markRead with timestamp alone skips message lookup and preserves nullable message cursor', async () => {
  const h = serviceHarness();
  const result = await new ReadStateService(h.unitOfWork, logger).markRead(
    TENANT,
    conversation.id,
    USER,
    NOW,
    null,
  );
  assert.equal(result.readState.lastReadMessageId, null);
  assert.equal(h.messages.findByIdInConversation.mock.callCount(), 0);
});
