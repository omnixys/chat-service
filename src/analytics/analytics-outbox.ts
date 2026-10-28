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

import type { ChatDatabase } from '../chat/persistence/prisma-chat.repository.js';
import { env } from '../config/env.js';
import type { InputJsonValue } from '../prisma/generated/internal/prismaNamespace.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AnalyticsFact, AnalyticsFactWriter } from './analytics.port.js';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';
import { randomUUID } from 'node:crypto';

/**
 * Transactional outbox writer.
 *
 * The fact is inserted with the caller's transaction, so a rolled back write also
 * drops the fact and a published event can never describe a message that does not
 * exist.
 */
export class PrismaAnalyticsFactWriter implements AnalyticsFactWriter {
  constructor(private readonly db: ChatDatabase) {}

  async enqueue(fact: AnalyticsFact): Promise<string> {
    const id = randomUUID();
    await this.db.analyticsOutbox.create({
      data: {
        id,
        tenantId: fact.tenantId,
        topic: fact.topic,
        correlationId: fact.correlationId ?? null,
        actorId: fact.actorId ?? null,
        payload: {
          id,
          eventName: fact.eventName,
          aggregateId: fact.aggregateId,
          aggregateType: fact.aggregateType,
          tenantId: fact.tenantId,
          subjectId: fact.subjectId ?? null,
          correlationId: fact.correlationId ?? null,
          actorId: fact.actorId ?? null,
          occurredAt: new Date().toISOString(),
          traceId: randomUUID(),
          properties: fact.properties,
        } as unknown as InputJsonValue,
      },
    });
    return id;
  }
}

export const ANALYTICS_OUTBOX_PUBLISHER = Symbol('ANALYTICS_OUTBOX_PUBLISHER');

export interface AnalyticsEventPublisher {
  publish(
    topic: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

export interface AnalyticsOutboxRow {
  readonly id: string;
  readonly tenantId: string;
  readonly topic: string;
  readonly payload: unknown;
}

/**
 * Drains the outbox in bounded batches.
 *
 * Rows are claimed with a conditional update so several instances can drain
 * concurrently without publishing the same fact twice. A publish failure releases
 * the row with a backoff; after `maxAttempts` the row is dead lettered so a
 * permanently failing topic cannot block the queue.
 */
@Injectable()
export class AnalyticsOutboxPublisher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger: ScopedLogger;
  private readonly instanceId = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private draining = false;

  constructor(
    @Inject(PrismaService) private readonly db: ChatDatabase,
    @Inject(ANALYTICS_OUTBOX_PUBLISHER)
    private readonly publisher: AnalyticsEventPublisher,
    @Inject(OmnixysLogger) logger: OmnixysLogger,
  ) {
    this.logger = logger.log(this.constructor.name);
  }

  /**
   * Bootstrapped with the application: an outbox that is never drained silently
   * grows the `analytics_outbox` table and drops every event.
   */
  onApplicationBootstrap(): void {
    if (!env.ANALYTICS_OUTBOX_ENABLED) {
      this.logger.warn('analytics_outbox_publisher_disabled', {
        reason: 'ANALYTICS_OUTBOX_ENABLED=false',
      });
      return;
    }
    this.start(
      env.ANALYTICS_OUTBOX_INTERVAL_MS,
      env.ANALYTICS_OUTBOX_BATCH_SIZE,
      env.ANALYTICS_OUTBOX_MAX_ATTEMPTS,
    );
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  start(intervalMs: number, batchSize: number, maxAttempts: number): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      void this.drainOnce(batchSize, maxAttempts).catch((cause: unknown) => {
        this.logger.error('analytics_outbox_drain_failed', {
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
    }, intervalMs);
    this.timer.unref();
    this.logger.info('analytics_outbox_publisher_started', { intervalMs });
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async drainOnce(batchSize: number, maxAttempts: number): Promise<number> {
    if (this.draining) {
      return 0;
    }
    this.draining = true;
    try {
      const rows = await this.claim(batchSize);
      for (const row of rows) {
        await this.publishRow(row, maxAttempts);
      }
      return rows.length;
    } finally {
      this.draining = false;
    }
  }

  private async claim(batchSize: number): Promise<AnalyticsOutboxRow[]> {
    const candidates = await this.db.analyticsOutbox.findMany({
      where: {
        publishedAt: null,
        deadLetteredAt: null,
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: batchSize,
    });

    const claimed: AnalyticsOutboxRow[] = [];
    for (const candidate of candidates) {
      const result = await this.db.analyticsOutbox.updateMany({
        where: { id: candidate.id, lockedAt: null },
        data: { lockedAt: new Date(), lockedBy: this.instanceId },
      });
      if (result.count === 1) {
        claimed.push({
          id: candidate.id,
          tenantId: candidate.tenantId,
          topic: candidate.topic,
          payload: candidate.payload,
        });
      }
    }
    return claimed;
  }

  private async publishRow(
    row: AnalyticsOutboxRow,
    maxAttempts: number,
  ): Promise<void> {
    const payload = asRecord(row.payload);
    try {
      await this.publisher.publish(row.topic, payload);
      await this.db.analyticsOutbox.update({
        where: { id: row.id },
        data: {
          publishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
    } catch (cause) {
      const attempts = await this.recordFailure(row.id, maxAttempts, cause);
      this.logger.warn('analytics_outbox_publish_failed', {
        outboxId: row.id,
        topic: row.topic,
        attempts,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  private async recordFailure(
    id: string,
    maxAttempts: number,
    cause: unknown,
  ): Promise<number> {
    const current = await this.db.analyticsOutbox.findUnique({
      where: { id },
      select: { attempts: true },
    });
    const attempts = (current?.attempts ?? 0) + 1;
    const deadLettered = attempts >= maxAttempts;

    await this.db.analyticsOutbox.update({
      where: { id },
      data: {
        attempts,
        lockedAt: null,
        lockedBy: null,
        lastError:
          cause instanceof Error ? cause.message.slice(0, 500) : String(cause),
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        ...(deadLettered ? { deadLetteredAt: new Date() } : {}),
      },
    });
    return attempts;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : { value };
}

/** Exponential backoff capped at five minutes. */
function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** (attempts - 1), 300_000);
}
