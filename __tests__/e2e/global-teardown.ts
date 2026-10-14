import { stopInfrastructure } from '../../../test-tools/e2e/infrastructure.mjs';
import type { GlobalTeardownContext } from 'vitest/node';

import { GATEWAY_STUB_KEY, type GatewayStub } from './global-setup.js';

export default async function teardown(
  _context: GlobalTeardownContext,
): Promise<void> {
  const stub = (globalThis as unknown as Record<symbol, GatewayStub>)[
    GATEWAY_STUB_KEY
  ];
  if (stub) {
    // The app keeps keep-alive sockets open to the double; closeAllConnections
    // lets the server shut down immediately instead of waiting them out.
    stub.server.closeAllConnections();
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
  }
  await stopInfrastructure();
}
