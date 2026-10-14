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

/**
 * @file main.ts
 * @description Bootstrap of the chat service.
 *
 * Fastify is the HTTP adapter, which also carries the GraphQL subscriptions over
 * `graphql-ws`. Helmet, CORS, compression and the rate limiter are registered as
 * Fastify plugins so they run before the Nest router and cannot be bypassed by
 * defining a controller route with a different prefix.
 */
import { AppModule } from './app.module.js';
import { corsOptions } from './config/cors.js';
import { env } from './config/env.js';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { OmnixysLogger } from '@omnixys/logger-ts';
import { registerFastifyTracing } from '@omnixys/observability-ts';
import type { FastifyRequest } from 'fastify';
import 'reflect-metadata';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      serializerOpts: {
        replacer: (_: string, value: unknown) =>
          typeof value === 'bigint' ? Number(value) : value,
      },
    }),
  );

  const fastify = app.getHttpAdapter().getInstance();
  registerFastifyTracing(fastify);
  const logger = app.get(OmnixysLogger).log('Bootstrap');

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  });

  await app.register(cors, corsOptions);

  await app.register(compress, {
    global: true,
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
  });

  // Health checks must never be throttled: a probe that gets a 429 makes an
  // orchestrator restart a healthy pod.
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_REQUESTS,
    timeWindow: env.RATE_LIMIT_WINDOW,
    allowList: (request: FastifyRequest) =>
      request.url.startsWith('/health') ||
      request.url.startsWith('/api/v1/internal'),
  });

  await app.register(cookie, { secret: env.COOKIE_SECRET });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');

  logger.info('chat service started', {
    service: env.SERVICE,
    port: env.PORT,
    environment: env.NODE_ENV,
  });
}

void bootstrap();
