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

import { ChatAdaptersModule } from './adapter/chat-adapters.module.js';
import { ValkeyAdapterModule } from './adapter/valkey-adapter.module.js';
import { ChatModule } from './chat/chat.module.js';
import { BannerService } from './config/banner.service.js';
import { env } from './config/env.js';
import { chatSchemaFile } from './config/graphql.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { Module } from '@nestjs/common';
import { ValkeyModule } from '@omnixys/cache-ts';
import { ContextModule, trustedProxyPolicyFromAddresses } from '@omnixys/context-ts';
import { OmnixysGraphQLModule } from '@omnixys/graphql-ts';
import { OmnixysHttpModule } from '@omnixys/http-ts';
import { KafkaModule } from '@omnixys/kafka-ts';
import { LoggerModule } from '@omnixys/logger-ts';
import { ObservabilityModule } from '@omnixys/observability-ts';
import { SecurityModule } from '@omnixys/security-ts';

const {
  SERVICE,
  NODE_ENV,
  KC_URL,
  KC_REALM,
  KC_AUDIENCE,
  ENCRYPTION_KEY,
  DEFAULT_TENANT_ID,
  KAFKA_BROKER,
  KAFKA_IDEMPOTENCY_ENABLE,
  KAFKA_IDEMPOTENCY_TTL,
  KAFKA_RETRY,
  OTEL_LOGS_ENABLED,
  OTEL_SAMPLING_RATIO,
  OTEL_TRANSPORT_MODE,
  OTEL_URI,
  PROMETHEUS_ENABLE,
  PROMETHEUS_PORT,
  RATE_LIMIT_ENABLE,
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW,
  TRUSTED_PROXY_ADDRESSES,
  VALKEY_PASSWORD,
  VALKEY_URL,
} = env;

/**
 * Composition root.
 *
 * Order matters: the logger first so every later module can log during its own
 * initialisation, then the shared infrastructure, then the bounded contexts that
 * consume it. The chat bounded context, its adapters and the transport modules are
 * kept in separate modules so the composition root stays readable.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      serviceName: SERVICE,
      registerGlobalInterceptor: true,
      batch: {
        enabled: env.LOG_BATCH_ENABLE,
        maxSize: env.LOG_BATCH_MAX_SIZE,
        flushInterval: env.LOG_BATCH_FLUSH_INTERVAL,
      },
    }),

    ContextModule.forRoot({
      tenant: {
        // Production is strict: a request without a verified tenant never reaches a
        // handler. Outside production the configured default keeps local work usable.
        mode: NODE_ENV === 'production' ? 'strict' : 'legacy',
        ...(DEFAULT_TENANT_ID === '' ? {} : { defaultTenantId: DEFAULT_TENANT_ID }),
      },
      trustedProxyPolicy: trustedProxyPolicyFromAddresses(TRUSTED_PROXY_ADDRESSES),
    }),

    OmnixysHttpModule.forRoot({ serviceName: SERVICE }),

    OmnixysGraphQLModule.forRoot({
      autoSchemaFile: chatSchemaFile,
      // `unreadCount` is a `@ResolveField` that validates the caller identity.
      // graphql-js invokes field resolvers outside the Nest interceptor chain
      // unless the driver is told to apply Nest enhancers to them; without this
      // flag the enriched tenant/principal context never reaches the resolver.
      fieldResolverEnhancers: ['guards', 'interceptors', 'filters'],
    }),

    ValkeyModule.forRoot({
      serviceName: SERVICE,
      url: VALKEY_URL,
      password: VALKEY_PASSWORD,
      pubSub: { enabled: true },
    }),

    KafkaModule.forRoot({
      clientId: SERVICE,
      brokers: [KAFKA_BROKER],
      groupId: `${SERVICE}-group`,
      serviceName: SERVICE,
      retry: { maxRetries: KAFKA_RETRY },
      idempotency: {
        enabled: KAFKA_IDEMPOTENCY_ENABLE,
        ttlSeconds: KAFKA_IDEMPOTENCY_TTL,
      },
    }),

    SecurityModule.forRoot({
      jwt: {
        issuer: `${KC_URL}/realms/${KC_REALM}`,
        ...(KC_AUDIENCE === '' ? {} : { audience: KC_AUDIENCE }),
        jwksUri: `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/certs`,
      },
      hash: { encryptionKey: ENCRYPTION_KEY },
      rateLimit: {
        enabled: RATE_LIMIT_ENABLE,
        defaultLimit: RATE_LIMIT_REQUESTS,
        defaultWindowMs: RATE_LIMIT_WINDOW,
        imports: [ValkeyAdapterModule],
      },
    }),

    ObservabilityModule.forRoot({
      serviceName: SERVICE,
      otel: {
        endpoint: OTEL_URI,
        transport: OTEL_TRANSPORT_MODE as 'http' | 'grpc',
        samplingRatio: OTEL_SAMPLING_RATIO,
      },
      logs: { enabled: OTEL_LOGS_ENABLED },
      metrics: { port: PROMETHEUS_PORT, enabled: PROMETHEUS_ENABLE },
    }),

    PrismaModule,
    ChatAdaptersModule,
    ChatModule,
    HealthModule,
  ],
  providers: [BannerService],
})
export class AppModule {}
