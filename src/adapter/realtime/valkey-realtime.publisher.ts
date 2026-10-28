import {
  transportChannel,
  type MessageCreatedEvent,
} from './realtime.events.js';
import type { RealtimePublisher } from './realtime.port.js';
import { Inject } from '@nestjs/common';
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

import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ValkeyPubSubService } from '@omnixys/cache-ts';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';
import { Observable, Subject } from 'rxjs';

/**
 * Realtime transport on Valkey pub/sub.
 *
 * Channels are published as `chat:{channel}` so the gateway, which subscribes to
 * `chat:conversation:*` and `chat:user:*`, receives them without any additional
 * wiring. A single process-wide subscription per channel is shared by all
 * subscribers through a `Subject`, which keeps a chat gateway with N open
 * subscriptions from opening N Valkey connections.
 */
@Injectable()
export class ValkeyRealtimePublisher
  implements RealtimePublisher, OnModuleDestroy
{
  private readonly logger: ScopedLogger;
  private readonly streams = new Map<string, Subject<MessageCreatedEvent>>();
  private readonly attachments = new WeakSet<Subject<MessageCreatedEvent>>();
  private readonly transitions = new Map<string, Promise<void>>();

  constructor(
    private readonly pubSub: ValkeyPubSubService,
    @Inject(OmnixysLogger) loggerToken: OmnixysLogger,
  ) {
    this.logger = loggerToken.log(this.constructor.name);
  }

  async publish(channel: string, event: MessageCreatedEvent): Promise<void> {
    await this.pubSub.publish(transportChannel(channel), event);
  }

  subscribe(channel: string): Observable<MessageCreatedEvent> {
    return new Observable<MessageCreatedEvent>((subscriber) => {
      const subject = this.subjectFor(channel);
      const inner = subject.subscribe(subscriber);
      this.attach(channel, subject);
      return () => {
        inner.unsubscribe();
        this.releaseIfIdle(channel, subject);
      };
    });
  }

  async health(): Promise<boolean> {
    const status = await this.pubSub.health();
    return status.healthy;
  }

  async onModuleDestroy(): Promise<void> {
    for (const subject of this.streams.values()) {
      subject.complete();
    }
    this.streams.clear();
    await Promise.all(this.transitions.values());
  }

  private subjectFor(channel: string): Subject<MessageCreatedEvent> {
    const existing = this.streams.get(channel);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Subject<MessageCreatedEvent>();
    this.streams.set(channel, created);
    return created;
  }

  private attach(channel: string, subject: Subject<MessageCreatedEvent>): void {
    if (this.attachments.has(subject)) {
      return;
    }
    this.attachments.add(subject);
    const previous = this.transitions.get(channel);
    const ready = (async () => {
      if (previous) {
        await previous;
      }
      if (!subject.observed) {
        return;
      }
      try {
        await this.pubSub.subscribe<MessageCreatedEvent>(
          transportChannel(channel),
          (data) => {
            if (data !== null && typeof data === 'object') {
              subject.next(data);
            }
          },
        );
        this.logger.debug('realtime_channel_subscribed', { channel });
      } catch (cause) {
        subject.error(cause);
        this.logger.error('realtime_subscribe_failed', {
          channel,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    })();
    this.transitions.set(channel, ready);
  }

  private releaseIfIdle(
    channel: string,
    subject: Subject<MessageCreatedEvent>,
  ): void {
    if (subject.observed) {
      return;
    }
    if (this.streams.get(channel) === subject) {
      this.streams.delete(channel);
    }
    // Finish any in-flight registration before releasing it. A new listener
    // waits for this release, so it cannot be removed by the old listener.
    const ready = this.transitions.get(channel) ?? Promise.resolve();
    const released = ready
      .then(() => this.pubSub.unsubscribe(transportChannel(channel)))
      .catch(() => undefined);
    this.transitions.set(channel, released);
    void released.then(() => {
      if (this.transitions.get(channel) === released) {
        this.transitions.delete(channel);
      }
    });
  }
}
