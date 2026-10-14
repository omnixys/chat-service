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

import type { GatewayChannelClient } from '../adapter/gateway/gateway.client.js';
import type { RealtimePublisher } from '../adapter/realtime/realtime.port.js';
import { REALTIME_PUBLISHER } from '../adapter/realtime/realtime.port.js';
import { GATEWAY_CHANNEL_CLIENT } from '../chat/ports/channel-adapters.token.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KafkaIndicator } from './kafka.indicator.js';
import { Controller, Get } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  type HealthIndicatorFunction,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { ValkeyPubSubService, ValkeyService } from '@omnixys/cache-ts';

const PROBE_TIMEOUT_MS = 3000;

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly cache: ValkeyService,
    private readonly pubSub: ValkeyPubSubService,
    private readonly kafka: KafkaIndicator,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(GATEWAY_CHANNEL_CLIENT)
    private readonly gateway: GatewayChannelClient,
  ) {}

  /**
   * Liveness only reports that the process is able to serve. It must not touch a
   * dependency: a slow database should not cause the orchestrator to restart a
   * process that is otherwise healthy.
   */
  @Get('liveness')
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([() => Promise.resolve({ app: { status: 'up' } })]);
  }

  @Get('readiness')
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    const checks: HealthIndicatorFunction[] = [
      () => Promise.resolve({ app: { status: 'up' } }),
      () => this.databaseHealth(),
      () => this.cacheHealth(),
      () => this.kafka.isHealthy(),
      () => this.realtimeHealth(),
      () => this.gatewayHealth(),
      () => this.externalHealth('keycloak', env.KEYCLOAK_HEALTH_URL),
      () => this.externalHealth('tempo', env.TEMPO_HEALTH_URL),
      () => this.externalHealth('prometheus', env.PROMETHEUS_HEALTH_URL),
    ];
    return this.health.check(checks);
  }

  private async databaseHealth(): Promise<HealthIndicatorResult> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up', latencyMs: Date.now() - startedAt } };
    } catch (cause) {
      return {
        database: {
          status: 'down',
          error: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }

  private async cacheHealth(): Promise<HealthIndicatorResult> {
    const health = await this.cache.health();
    return {
      cache: {
        status: health.healthy ? 'up' : 'down',
        connectionStatus: health.status,
        latencyMs: health.latencyMs,
      },
    };
  }

  /**
   * The realtime path carries message delivery to connected clients, so it is part
   * of readiness: an instance that cannot publish would silently drop chat events.
   */
  private async realtimeHealth(): Promise<HealthIndicatorResult> {
    const [realtime, pubSub] = await Promise.all([this.realtime.health(), this.pubSub.health()]);
    return {
      realtime: {
        status: realtime && pubSub.healthy ? 'up' : 'down',
        connectionStatus: pubSub.status,
      },
    };
  }

  private async gatewayHealth(): Promise<HealthIndicatorResult> {
    try {
      const healthy = await this.gateway.health();
      return { gateway: { status: healthy ? 'up' : 'down' } };
    } catch (cause) {
      return {
        gateway: {
          status: 'down',
          error: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }

  private async externalHealth(name: string, url: string): Promise<HealthIndicatorResult> {
    if (url === '') {
      return { [name]: { status: 'up', skipped: true } };
    }
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return {
        [name]: {
          status: response.ok ? 'up' : 'down',
          statusCode: response.status,
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (cause) {
      return {
        [name]: {
          status: 'down',
          latencyMs: Date.now() - startedAt,
          error: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }
}
