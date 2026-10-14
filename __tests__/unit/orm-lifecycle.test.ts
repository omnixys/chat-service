import type { ChatDatabase } from '../../dist/chat/persistence/prisma-chat.repository.js';
import type { UnitOfWorkContext } from '../../dist/chat/ports/unit-of-work.port.js';
import type { PrismaService as PrismaType } from '../../dist/prisma/prisma.service.js';
import './chat-fixtures.ts';
import {
  dependency,
  NOW,
  TENANT,
  USER,
  conversation,
  message,
} from './chat-fixtures.ts';
import assert from 'node:assert/strict';
import test, { mock, type Mock } from 'node:test';
const spans = mock.fn((..._args: unknown[]): void => {});
const observability = await import('@omnixys/observability-ts');
mock.module('@omnixys/observability-ts', {
  namedExports: { ...observability, setupPrismaSpans: spans },
});
const crypto = await import('node:crypto');
mock.module('node:crypto', {
  namedExports: { ...crypto, randomUUID: () => message.id },
  defaultExport: { ...crypto.default, randomUUID: () => message.id },
});
const { PrismaService } = await import('../../dist/prisma/prisma.service.js');
const { PrismaUnitOfWork } =
  await import('../../dist/chat/persistence/prisma-unit-of-work.js');
const { PrismaAnalyticsFactWriter } =
  await import('../../dist/analytics/analytics-outbox.js');
interface LifecycleHarness {
  subject: PrismaType;
  connect: Mock<() => Promise<void>>;
  disconnect: Mock<() => Promise<void>>;
  info: Mock<(...args: unknown[]) => void>;
}
function lifecycleHarness(): LifecycleHarness {
  const connect = mock.fn(async (): Promise<void> => {});
  const disconnect = mock.fn(async (): Promise<void> => {});
  const info = mock.fn((..._args: unknown[]): void => {});
  const subject = Object.assign(
    Object.create(PrismaService.prototype) as PrismaType,
    { $connect: connect, $disconnect: disconnect, logger: { info } },
  );
  return { subject, connect, disconnect, info };
}
// @covers PrismaService.onModuleInit
await test('Prisma initialization instruments and connects before reporting readiness', async () => {
  const h = lifecycleHarness();
  const prior = spans.mock.callCount();
  await h.subject.onModuleInit();
  assert.equal(spans.mock.callCount(), prior + 1);
  assert.equal(spans.mock.calls.at(-1)?.arguments[0], h.subject);
  assert.equal(h.connect.mock.callCount(), 1);
  assert.deepEqual(h.info.mock.calls[0]?.arguments, [
    'Database connection established',
  ]);
});
await test('Prisma connection failure propagates without reporting successful startup', async () => {
  const h = lifecycleHarness();
  const cause = new Error('connect failed');
  h.connect.mock.mockImplementationOnce(async () => {
    throw cause;
  });
  await assert.rejects(h.subject.onModuleInit(), cause);
  assert.equal(h.info.mock.callCount(), 0);
});
// @covers PrismaService.onModuleDestroy
await test('Prisma shutdown awaits disconnect before logging completion', async () => {
  const h = lifecycleHarness();
  const finish = Promise.withResolvers<void>();
  h.disconnect.mock.mockImplementationOnce(async () => finish.promise);
  const result = h.subject.onModuleDestroy();
  assert.equal(h.info.mock.callCount(), 0);
  finish.resolve();
  await result;
  assert.deepEqual(h.info.mock.calls[0]?.arguments, [
    'Database connection closed',
  ]);
});
await test('Prisma shutdown failure is observable and does not log success', async () => {
  const h = lifecycleHarness();
  const cause = new Error('disconnect failed');
  h.disconnect.mock.mockImplementationOnce(async () => {
    throw cause;
  });
  await assert.rejects(h.subject.onModuleDestroy(), cause);
  assert.equal(h.info.mock.callCount(), 0);
});
// @covers PrismaUnitOfWork.transaction
await test('unit of work constructs all persistence ports from the same transaction client and preserves callback result', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const messageRead = mock.fn(async (_input: unknown) => message);
  const readStateRead = mock.fn(async (_input: unknown) => null);
  const outboxCreate = mock.fn(async (_input: unknown) => ({ id: message.id }));
  const tx = dependency<ChatDatabase>({
    message: dependency<ChatDatabase['message']>({
      findFirst: messageRead as unknown as ChatDatabase['message']['findFirst'],
    }),
    readState: dependency<ChatDatabase['readState']>({
      findUnique:
        readStateRead as unknown as ChatDatabase['readState']['findUnique'],
    }),
    analyticsOutbox: dependency<ChatDatabase['analyticsOutbox']>({
      create:
        outboxCreate as unknown as ChatDatabase['analyticsOutbox']['create'],
    }),
  });
  const transaction = mock.fn(
    async (work: (client: ChatDatabase) => Promise<unknown>) => work(tx),
  );
  const unit = new PrismaUnitOfWork(
    dependency<PrismaType>({
      $transaction: transaction as unknown as PrismaType['$transaction'],
    }),
  );
  const result = await unit.transaction(async (context) => {
    assert.equal(
      context.conversationRepository.constructor.name,
      'PrismaConversationRepository',
    );
    assert.equal(
      context.messageRepository.constructor.name,
      'PrismaMessageRepository',
    );
    assert.equal(
      context.readStateRepository.constructor.name,
      'PrismaReadStateRepository',
    );
    assert.deepEqual(
      await context.messageRepository.findById(TENANT, message.id),
      message,
    );
    assert.equal(
      await context.readStateRepository.find(TENANT, conversation.id, USER),
      null,
    );
    return context.analytics.enqueue({
      topic: 'chat.message.sent.v1',
      eventName: 'message.sent',
      aggregateId: message.id,
      aggregateType: 'chat.message',
      tenantId: TENANT,
      properties: { bodyLength: 5 },
    });
  });
  assert.equal(result, message.id);
  assert.equal(transaction.mock.callCount(), 1);
  assert.deepEqual(messageRead.mock.calls[0]?.arguments, [
    { where: { tenantId: TENANT, id: message.id } },
  ]);
  assert.equal(outboxCreate.mock.callCount(), 1);
});
await test('unit of work propagates both transaction and callback failures', async () => {
  const tx = dependency<ChatDatabase>({});
  const transaction = mock.fn(
    async (work: (client: ChatDatabase) => Promise<unknown>) => work(tx),
  );
  const unit = new PrismaUnitOfWork(
    dependency<PrismaType>({
      $transaction: transaction as unknown as PrismaType['$transaction'],
    }),
  );
  const cause = new Error('callback failed');
  await assert.rejects(
    unit.transaction(async (_context: UnitOfWorkContext) => {
      throw cause;
    }),
    cause,
  );
  const dbCause = new Error('transaction failed');
  transaction.mock.mockImplementationOnce(async () => {
    throw dbCause;
  });
  await assert.rejects(
    unit.transaction(async () => true),
    dbCause,
  );
});
await test('transactional analytics writer preserves tenant and nullable metadata in the actual outbox insert', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const create = mock.fn(async (_input: unknown) => ({ id: message.id }));
  const writer = new PrismaAnalyticsFactWriter(
    dependency<ChatDatabase>({
      analyticsOutbox: dependency<ChatDatabase['analyticsOutbox']>({
        create: create as unknown as ChatDatabase['analyticsOutbox']['create'],
      }),
    }),
  );
  assert.equal(
    await writer.enqueue({
      topic: 'chat.message.sent.v1',
      eventName: 'message.sent',
      aggregateId: message.id,
      aggregateType: 'chat.message',
      subjectId: USER,
      tenantId: TENANT,
      properties: { bodyLength: 5 },
    }),
    message.id,
  );
  assert.deepEqual(create.mock.calls[0]?.arguments, [
    {
      data: {
        id: message.id,
        tenantId: TENANT,
        topic: 'chat.message.sent.v1',
        correlationId: null,
        actorId: null,
        payload: {
          id: message.id,
          eventName: 'message.sent',
          aggregateId: message.id,
          aggregateType: 'chat.message',
          tenantId: TENANT,
          subjectId: USER,
          correlationId: null,
          actorId: null,
          occurredAt: NOW.toISOString(),
          traceId: message.id,
          properties: { bodyLength: 5 },
        },
      },
    },
  ]);
});
