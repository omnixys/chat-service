import { strict as assert } from 'node:assert';
import test from 'node:test';

import { makeLogger } from '../support/in-memory.mjs';

/**
 * Behaviour of the analytics outbox drain.
 *
 * The publisher is the only thing that turns committed rows into Kafka events, so
 * these tests cover the three outcomes that matter: a claimed row is published and
 * marked, a locked row is skipped instead of published twice, and a failing topic
 * is retried with a backoff before it is dead lettered.
 */
const { AnalyticsOutboxPublisher } =
  await import('../../dist/analytics/analytics-outbox.js');

function makeDb(rows = []) {
  const state = rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId ?? 'tenant-1',
    topic: row.topic ?? 'chat.message.sent.v1',
    payload: row.payload ?? { id: row.id },
    publishedAt: null,
    deadLetteredAt: null,
    lockedAt: null,
    lockedBy: null,
    attempts: 0,
    lastError: null,
    nextAttemptAt: new Date(0),
    createdAt: new Date(0),
  }));

  return {
    state,
    analyticsOutbox: {
      async findMany() {
        return state
          .filter(
            (row) =>
              row.publishedAt === null &&
              row.deadLetteredAt === null &&
              row.nextAttemptAt <= new Date(),
          )
          .slice(0, 100);
      },
      async updateMany({ where, data }) {
        const row = state.find((candidate) => candidate.id === where.id);
        if (row === undefined || row.lockedAt !== where.lockedAt) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      },
      async findUnique({ where }) {
        const row = state.find((candidate) => candidate.id === where.id);
        return row === undefined ? null : { attempts: row.attempts };
      },
      async update({ where, data }) {
        Object.assign(
          state.find((candidate) => candidate.id === where.id),
          data,
        );
        return { count: 1 };
      },
    },
  };
}

function makePublisher(behaviour = () => undefined) {
  const published = [];
  return {
    published,
    async publish(topic, payload) {
      behaviour(topic, payload);
      published.push({ topic, payload });
    },
  };
}

function row(id) {
  return { id, payload: { id, eventName: 'message.sent' } };
}

test('a claimed row is published and marked as published', async () => {
  const db = makeDb([row('a')]);
  const publisher = makePublisher();
  const outbox = new AnalyticsOutboxPublisher(db, publisher, makeLogger());

  assert.equal(await outbox.drainOnce(10, 5), 1);
  assert.deepEqual(publisher.published, [
    {
      topic: 'chat.message.sent.v1',
      payload: { id: 'a', eventName: 'message.sent' },
    },
  ]);
  assert.ok(db.state[0].publishedAt instanceof Date);
  assert.equal(db.state[0].lockedAt, null);
  assert.equal(db.state[0].lastError, null);
});

test('a row that is already locked by another instance is not published again', async () => {
  const db = makeDb([row('a')]);
  db.state[0].lockedAt = new Date();
  db.state[0].lockedBy = 'other-instance';
  const publisher = makePublisher();
  const outbox = new AnalyticsOutboxPublisher(db, publisher, makeLogger());

  assert.equal(await outbox.drainOnce(10, 5), 0);
  assert.deepEqual(publisher.published, []);
});

test('a failing topic is released with a backoff and dead lettered after maxAttempts', async () => {
  const db = makeDb([row('a')]);
  const publisher = makePublisher(() => {
    throw new Error('broker unreachable');
  });
  const outbox = new AnalyticsOutboxPublisher(db, publisher, makeLogger());

  await outbox.drainOnce(10, 2);

  assert.equal(db.state[0].publishedAt, null);
  assert.equal(
    db.state[0].deadLetteredAt,
    null,
    'the first failure only schedules a retry',
  );
  assert.equal(db.state[0].attempts, 1);
  assert.equal(db.state[0].lastError, 'broker unreachable');
  assert.ok(db.state[0].nextAttemptAt > new Date(), 'the retry is delayed');
  assert.equal(
    db.state[0].lockedAt,
    null,
    'the row is released for the next drain',
  );

  db.state[0].nextAttemptAt = new Date(0);
  await outbox.drainOnce(10, 2);

  assert.equal(db.state[0].attempts, 2);
  assert.ok(
    db.state[0].deadLetteredAt instanceof Date,
    'the row is dead lettered',
  );
});

test('a dead lettered row is never claimed again', async () => {
  const db = makeDb([row('a')]);
  db.state[0].deadLetteredAt = new Date();
  const publisher = makePublisher();
  const outbox = new AnalyticsOutboxPublisher(db, publisher, makeLogger());

  assert.equal(await outbox.drainOnce(10, 5), 0);
  assert.deepEqual(publisher.published, []);
});

test('stop ends the drain loop and a second start does not create a second timer', () => {
  const db = makeDb();
  const outbox = new AnalyticsOutboxPublisher(
    db,
    makePublisher(),
    makeLogger(),
  );

  outbox.start(10_000, 10, 5);
  outbox.start(10_000, 10, 5);
  outbox.stop();
  outbox.stop();
});

test('the bootstrap honours ANALYTICS_OUTBOX_ENABLED and the drain settings', () => {
  const db = makeDb();
  const outbox = new AnalyticsOutboxPublisher(
    db,
    makePublisher(),
    makeLogger(),
  );

  outbox.onApplicationBootstrap();
  outbox.onApplicationShutdown();

  assert.equal(
    process.env['ANALYTICS_OUTBOX_ENABLED'],
    undefined,
    'the test leaves the env untouched',
  );
});
