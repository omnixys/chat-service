import 'reflect-metadata';

import { buildSubgraphSchema } from '@apollo/subgraph';
import { GraphQLFederationFactory } from '@nestjs/graphql';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inject } from 'vitest';

import { applyE2eEnv } from '../../../test-tools/e2e/infrastructure.mjs';

const execFileAsync = promisify(execFile);

export interface TestApp {
  app: NestFastifyApplication;
  moduleRef: TestingModule;
}

/**
 * The installed `@apollo/subgraph` accepts an array of modules while
 * `@nestjs/graphql` passes a single module object. Keep the real schema and
 * compiler, adapting just that framework call — the same shim the local
 * integration harness uses.
 */
function adaptFederationSchemaBuild(moduleRef: TestingModule): void {
  const factory = moduleRef.get(GraphQLFederationFactory, { strict: false });
  const original = factory.generateSchema.bind(factory);
  factory.generateSchema = ((options: unknown) =>
    original(
      options as never,
      ((schema: unknown) => buildSubgraphSchema([schema])) as never,
    )) as typeof factory.generateSchema;
}

export async function createTestApp(): Promise<TestApp> {
  const e2e = inject<Record<string, string | number | boolean> | undefined>(
    'omnixys-e2e',
  );
  if (!e2e) {
    throw new Error('omnixys-e2e not provided by globalSetup');
  }
  applyE2eEnv(e2e);

  // The additive tenant-scope migration refuses to run unless
  // `chat.default_tenant_id` is set, exactly like the integration harness. It is
  // a session GUC, so it is passed through the connection URL for the migration
  // process only and never persisted on the role or cluster.
  const databaseUrl = new URL(process.env.DATABASE_URL as string);
  databaseUrl.searchParams.set(
    'options',
    `-c chat.default_tenant_id=${process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000'}`,
  );
  await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
  });

  const { AppModule } = await import('../../dist/app.module.js');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  adaptFederationSchemaBuild(moduleRef);

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, moduleRef };
}

export async function shutdownTestApp(
  testApp: TestApp | undefined,
): Promise<void> {
  await settle(testApp?.app?.close());
  await settle(testApp?.moduleRef?.close());
}

async function settle(operation: Promise<unknown> | undefined): Promise<void> {
  if (!operation) {
    return;
  }
  await operation.catch(() => undefined);
}
