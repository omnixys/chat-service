import type { StartInfrastructureOptions } from '../../../test-tools/e2e/infrastructure.mjs';

/**
 * E2E infrastructure declaration for the chat service.
 *
 * `GATEWAY_BASE_URL` is not set here: the global setup starts a small HTTP
 * double for the gateway channel client and injects its address, because
 * readiness probes that dependency.
 */
const config: StartInfrastructureOptions = {
  serviceDir: process.cwd(),
  needs: { postgres: true, valkey: true, kafka: true, keycloak: true },
  kafkaTopics: [],
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    LOG_CONSOLE_LEVEL: 'silent',
    LOG_OTEL_LEVEL: 'silent',
    LOG_BATCH_ENABLE: 'false',
    OTEL_SDK_DISABLED: 'true',
    OTEL_LOGS_ENABLED: 'false',
    PROMETHEUS_ENABLE: 'false',
    RATE_LIMIT_ENABLE: 'false',
    ANALYTICS_OUTBOX_ENABLED: 'false',
    KEYCLOAK_HEALTH_URL: '',
    TEMPO_HEALTH_URL: '',
    PROMETHEUS_HEALTH_URL: '',
    DOTENV_CONFIG_PATH: '/dev/null',
    ENCRYPTION_KEY:
      '45f31eb50858659cdea737527cf3a7db53062fc5c9976fa85b6a8deaad3758a2',
    COOKIE_SECRET: 'omnixys-e2e-cookie-secret',
    TRUSTED_PROXY_ADDRESSES: '127.0.0.1,::1',
    DEFAULT_TENANT_ID: '',
    KC_AUDIENCE: '',
    GATEWAY_API_KEY: 'omnixys-e2e-gateway-key',
    INTERNAL_GATEWAY_TOKEN: 'omnixys-e2e-internal-token',
    GATEWAY_TIMEOUT: '10000',
  },
};

export default config;
