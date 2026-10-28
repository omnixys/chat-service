import { startInfrastructure } from '../../../test-tools/e2e/infrastructure.mjs';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import type { GlobalSetupContext } from 'vitest/node';

import config from './e2e.config.js';

const execFileAsync = promisify(execFile);

/**
 * Symbol key under which the gateway HTTP double is parked on `globalThis` so
 * the teardown hook can close it. Vitest runs both hooks in the same process.
 */
export const GATEWAY_STUB_KEY = Symbol.for('omnixys-chat-e2e-gateway-stub');

export interface GatewayStub {
  server: Server;
}

export default async function setup({
  provide,
}: GlobalSetupContext): Promise<void> {
  const infra = await startInfrastructure(config);

  // The chat readiness probe calls the gateway channel client, so a small HTTP
  // double answers `/health` (and any send path) for the duration of the suite.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', success: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  (globalThis as unknown as Record<symbol, GatewayStub>)[GATEWAY_STUB_KEY] = {
    server,
  };
  infra.env.GATEWAY_BASE_URL = `http://127.0.0.1:${port}`;

  // The suite boots the compiled artifact (dist/), exactly like the
  // integration harness, so tsc's decorator metadata is used.
  await execFileAsync('pnpm', ['run', 'build'], { env: { ...process.env } });

  provide<Record<string, string | number | boolean>>('omnixys-e2e', infra.env);
}
