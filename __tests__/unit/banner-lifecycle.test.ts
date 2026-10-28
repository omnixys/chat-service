import './chat-fixtures.ts';
import { dependency } from './chat-fixtures.ts';
import type { OmnixysLogger } from '@omnixys/logger-ts';
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
const os = await import('node:os');
const { default: _default, ...namedOS } = os;
const simulated = {
  ...namedOS,
  type: (): string => 'UnitOS',
  release: (): string => 'unit-release',
  userInfo: () => ({
    username: 'unit-user',
    uid: 1,
    gid: 1,
    shell: '/unit-shell',
    homedir: '/unit-home',
  }),
};
mock.module('node:os', { namedExports: simulated, defaultExport: simulated });
const { BannerService } = await import('../../dist/config/banner.service.js');
const { nodeConfig } = await import('../../dist/config/node.js');
// @covers BannerService.onApplicationBootstrap
await test('banner logs the actual application/platform details and masks gateway secrets', () => {
  const info = mock.fn((..._args: unknown[]): void => {});
  const logger = dependency<OmnixysLogger>({
    log: () => dependency<ReturnType<OmnixysLogger['log']>>({ info }),
  });
  new BannerService(logger).onApplicationBootstrap();
  const text = info.mock.calls
    .map((call) => String(call.arguments[0]))
    .join('\n');
  for (const value of [
    '=== chat-unit ===',
    'Anwendungsname: chat-unit',
    process.version,
    'UnitOS (unit-release)',
    'unit-user',
    String(nodeConfig.port),
    'Log Directory:',
  ]) {
    assert.ok(text.includes(value));
  }
  assert.match(text, /GATEWAY_API_KEY/);
  assert.doesNotMatch(text, /chat-unit-gateway-key|chat-unit-internal-key/);
});
await test('banner default logger branch avoids custom file configuration details', () => {
  const prior = nodeConfig.logger.logDefault;
  nodeConfig.logger.logDefault = true;
  const info = mock.fn((..._args: unknown[]): void => {});
  const logger = dependency<OmnixysLogger>({
    log: () => dependency<ReturnType<OmnixysLogger['log']>>({ info }),
  });
  try {
    new BannerService(logger).onApplicationBootstrap();
    const text = info.mock.calls
      .map((call) => String(call.arguments[0]))
      .join('\n');
    assert.match(text, /Default Logger!/);
    assert.doesNotMatch(text, /Log Directory:/);
  } finally {
    nodeConfig.logger.logDefault = prior;
  }
});
await test('banner logging failure propagates before subsequent details', () => {
  const cause = new Error('log failed');
  const info = mock.fn((..._args: unknown[]): void => {
    throw cause;
  });
  const logger = dependency<OmnixysLogger>({
    log: () => dependency<ReturnType<OmnixysLogger['log']>>({ info }),
  });
  assert.throws(
    () => new BannerService(logger).onApplicationBootstrap(),
    cause,
  );
  assert.equal(info.mock.callCount(), 1);
});

await test('banner rejects incomplete production configuration before any startup details are logged', async () => {
  const { env } = await import('../../dist/config/env.js');
  const priorMode = env.NODE_ENV;
  const priorCookie = env.COOKIE_SECRET;
  Reflect.set(env, 'NODE_ENV', 'production');
  Reflect.set(env, 'COOKIE_SECRET', '');
  const info = mock.fn((..._args: unknown[]): void => {});
  const logger = dependency<OmnixysLogger>({
    log: () => dependency<ReturnType<OmnixysLogger['log']>>({ info }),
  });
  try {
    assert.throws(
      () => new BannerService(logger).onApplicationBootstrap(),
      /Missing required production settings:.*COOKIE_SECRET/,
    );
    assert.equal(info.mock.callCount(), 0);
  } finally {
    Reflect.set(env, 'NODE_ENV', priorMode);
    Reflect.set(env, 'COOKIE_SECRET', priorCookie);
  }
});
