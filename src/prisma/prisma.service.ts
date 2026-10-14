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
import { PrismaClient } from './generated/client.js';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';
import { setupPrismaSpans } from '@omnixys/observability-ts';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger: ScopedLogger;

  // The token is explicit because `PrismaClient`'s variadic constructor leaks
  // `[Function]` into `design:paramtypes`, which Nest would try to resolve.
  constructor(@Inject(OmnixysLogger) logger: OmnixysLogger) {
    super({
      adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
      log: [{ emit: 'event', level: 'query' }],
    });
    this.logger = logger.log(this.constructor.name, 'service:chat');
  }

  async onModuleInit(): Promise<void> {
    setupPrismaSpans(this);

    await this.$connect();
    this.logger.info('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info('Database connection closed');
  }
}
