import 'dotenv/config';
import process from 'node:process';

type EnvValue = string | number | boolean;
interface GetEnvOptions<T extends EnvValue = string> {
  required?: boolean;
  transform?: (value: string) => T;
}

function getEnv(
  key: string,
  fallback?: string,
  options?: GetEnvOptions<string>,
): string;
function getEnv<T extends EnvValue>(
  key: string,
  fallback: string,
  options: GetEnvOptions<T> & { transform: (value: string) => T },
): T;
function getEnv(
  key: string,
  fallback?: string,
  options?: GetEnvOptions,
): EnvValue {
  const raw = process.env[key];
  if (!raw) {
    if (
      options?.required &&
      ['production', 'development', 'staging'].includes(
        process.env.NODE_ENV ?? '',
      )
    ) {
      throw new Error(`[ENV] Missing required env: ${key}`);
    }
    return options?.transform && fallback !== undefined
      ? options.transform(fallback)
      : (fallback ?? '');
  }
  return options?.transform ? options.transform(raw) : raw;
}

const toBool = (value: string): boolean => value === 'true';
const toNumber = (value: string): number => Number(value);

export const env = {
  NODE_ENV: getEnv('NODE_ENV', 'development', { required: true }),
  PORT: getEnv('PORT', '8000', { transform: toNumber }),
  SERVICE: getEnv('SERVICE', 'chat'),
  TRUSTED_PROXY_ADDRESSES: getEnv('TRUSTED_PROXY_ADDRESSES', ''),
  SCHEMA_TARGET: getEnv('SCHEMA_TARGET', 'true'),
  HTTPS: getEnv('HTTPS', 'false', { transform: toBool }),
  KEYS_PATH: getEnv('KEYS_PATH', './keys'),

  LOG_DEFAULT: getEnv('LOG_DEFAULT', 'false', { transform: toBool }),
  LOG_DIRECTORY: getEnv('LOG_DIRECTORY', 'log'),
  LOG_FILE_DEFAULT_NAME: getEnv('LOG_FILE_DEFAULT_NAME', 'server.log'),
  LOG_PRETTY: getEnv('LOG_PRETTY', 'false', { transform: toBool }),
  LOG_LEVEL: getEnv('LOG_LEVEL', 'info'),
  LOG_BATCH_ENABLE: getEnv('LOG_BATCH_ENABLE', 'true', { transform: toBool }),
  LOG_BATCH_MAX_SIZE: getEnv('LOG_BATCH_MAX_SIZE', '50', {
    transform: toNumber,
  }),
  LOG_BATCH_FLUSH_INTERVAL: getEnv('LOG_BATCH_FLUSH_INTERVAL', '2000', {
    transform: toNumber,
  }),

  OTEL_LOGS_ENABLED: getEnv('OTEL_LOGS_ENABLED', 'true', { transform: toBool }),
  OTEL_URI: getEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318', {
    required: true,
  }),
  OTEL_TRANSPORT_MODE: getEnv('OTEL_TRANSPORT_MODE', 'http', {
    required: true,
  }),
  OTEL_SAMPLING_RATIO: getEnv('OTEL_SAMPLING_RATIO', '1', {
    transform: toNumber,
  }),
  TEMPO_URI: getEnv('TEMPO_URI', 'http://localhost:4318', { required: true }),
  PROMETHEUS_ENABLE: getEnv('PROMETHEUS_ENABLE', 'true', { transform: toBool }),
  PROMETHEUS_PORT: getEnv('PROMETHEUS_PORT', '9464', { transform: toNumber }),

  KAFKA_BROKER: getEnv('KAFKA_BROKER', 'localhost:9092', { required: true }),
  KAFKA_RETRY: getEnv('KAFKA_RETRY', '5', { transform: toNumber }),
  KAFKA_IDEMPOTENCY_ENABLE: getEnv('KAFKA_IDEMPOTENCY_ENABLE', 'true', {
    transform: toBool,
  }),
  KAFKA_IDEMPOTENCY_TTL: getEnv('KAFKA_IDEMPOTENCY_TTL', '86400', {
    transform: toNumber,
  }),
  ANALYTICS_OUTBOX_ENABLED: getEnv('ANALYTICS_OUTBOX_ENABLED', 'true', {
    transform: toBool,
  }),
  ANALYTICS_OUTBOX_INTERVAL_MS: getEnv('ANALYTICS_OUTBOX_INTERVAL_MS', '1000', {
    transform: toNumber,
  }),
  ANALYTICS_OUTBOX_BATCH_SIZE: getEnv('ANALYTICS_OUTBOX_BATCH_SIZE', '100', {
    transform: toNumber,
  }),
  ANALYTICS_OUTBOX_MAX_ATTEMPTS: getEnv('ANALYTICS_OUTBOX_MAX_ATTEMPTS', '5', {
    transform: toNumber,
  }),

  VALKEY_URL: getEnv('VALKEY_URL', 'valkey://localhost:6380', {
    required: true,
  }),
  VALKEY_PASSWORD: getEnv('VALKEY_PASSWORD', '', { required: true }),
  RATE_LIMIT_ENABLE: getEnv('RATE_LIMIT_ENABLE', 'true', { transform: toBool }),
  RATE_LIMIT_REQUESTS: getEnv('RATE_LIMIT_REQUEST', '100', {
    transform: toNumber,
  }),
  RATE_LIMIT_WINDOW: getEnv('RATE_LIMIT_WINDOW', '60000', {
    transform: toNumber,
  }),

  KC_CLIENT_SECRET: getEnv('KC_CLIENT_SECRET', '', { required: true }),
  KC_URL: getEnv('KC_URL', 'http://localhost:18080/auth', { required: true }),
  KC_REALM: getEnv('KC_REALM', 'camunda-platform', { required: true }),
  KC_CLIENT_ID: getEnv('KC_CLIENT_ID', 'camunda-identity', { required: true }),
  KC_AUDIENCE: getEnv('KC_AUDIENCE', ''),
  COOKIE_SECRET: getEnv('COOKIE_SECRET', '', { required: true }),
  ENCRYPTION_KEY: getEnv('ENCRYPTION_KEY', '', { required: true }),
  DEFAULT_TENANT_ID: getEnv('DEFAULT_TENANT_ID', '', { required: true }),

  KEYCLOAK_HEALTH_URL: getEnv('KEYCLOAK_HEALTH_URL', '', { required: true }),
  TEMPO_HEALTH_URL: getEnv('TEMPO_HEALTH_URL', '', { required: true }),
  PROMETHEUS_HEALTH_URL: getEnv('PROMETHEUS_HEALTH_URL', '', {
    required: true,
  }),
  DATABASE_URL: getEnv('DATABASE_URL', '', { required: true }),
  GATEWAY_BASE_URL: getEnv('GATEWAY_BASE_URL', 'http://localhost:8002', {
    required: true,
  }),
  GATEWAY_API_KEY: getEnv('GATEWAY_API_KEY', '', { required: true }),
  GATEWAY_TIMEOUT: getEnv('GATEWAY_TIMEOUT', '30000', { transform: toNumber }),
  INTERNAL_GATEWAY_TOKEN: getEnv('INTERNAL_GATEWAY_TOKEN', '', {
    required: true,
  }),
} as const;

export type ChatEnv = typeof env;

export function validateProductionSettings(): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  const required = [
    'DATABASE_URL',
    'DEFAULT_TENANT_ID',
    'KC_CLIENT_SECRET',
    'KC_URL',
    'COOKIE_SECRET',
    'ENCRYPTION_KEY',
    'VALKEY_URL',
    'INTERNAL_GATEWAY_TOKEN',
    'GATEWAY_BASE_URL',
    'GATEWAY_API_KEY',
  ] as const;
  const missing = required.filter((key) => String(env[key]).trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `[ENV] Missing required production settings: ${missing.join(', ')}`,
    );
  }
}

export function keycloakIssuer(): string {
  return `${env.KC_URL}/realms/${env.KC_REALM}`;
}
export function keycloakJwksUri(): string {
  return `${env.KC_URL}/realms/${env.KC_REALM}/protocol/openid-connect/certs`;
}
export function isProduction(): boolean {
  return env.NODE_ENV === 'production';
}
