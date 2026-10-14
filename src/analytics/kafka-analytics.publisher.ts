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

import { env } from '../config/env.js';
import type { AnalyticsEventPublisher } from './analytics-outbox.js';
import { Injectable } from '@nestjs/common';
import { KafkaProducerService } from '@omnixys/kafka-ts';

/**
 * Publishes outbox rows as raw Kafka records.
 *
 * The envelope and the `x-*` headers are the analytics pipeline's contract and are
 * byte-for-byte identical to what the Python service produced, so the analytics
 * service keeps working across the migration. `rawSend` is used instead of the
 * typed `send` because the chat fact topics are not part of the shared
 * `KafkaEventRegistry`; see PORTING-NOTES.md.
 *
 * The producer is injected by class: binding it to `ANALYTICS_OUTBOX_PUBLISHER`
 * would make this provider depend on itself.
 */
@Injectable()
export class KafkaAnalyticsEventPublisher implements AnalyticsEventPublisher {
  constructor(private readonly producer: KafkaProducerService) {}

  async publish(
    topic: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const eventId = readString(payload['id']) ?? env.SERVICE;
    const eventName = readString(payload['eventName']) ?? topic;
    const tenantId = readString(payload['tenantId']) ?? '';
    const correlationId = readString(payload['correlationId']);
    const actorId = readString(payload['actorId']);

    const envelope = {
      eventId,
      eventName,
      eventType: 'EVENT',
      eventVersion: '1',
      service: env.SERVICE,
      timestamp: readString(payload['occurredAt']) ?? new Date().toISOString(),
      payload,
    };

    await this.producer.rawSend(
      topic,
      JSON.stringify(envelope),
      removeUndefined({
        'x-tenant-id': tenantId,
        'x-event-id': eventId,
        'x-event-version': '1',
        'x-event-type': 'EVENT',
        'x-service': env.SERVICE,
        'x-correlation-id': correlationId,
        'x-actor-id': actorId,
      }),
    );
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function removeUndefined(
  headers: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}
