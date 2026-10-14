import { env } from './env.js';
import { httpsOptions } from './https.js';
import type { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface.js';
import { hostname } from 'node:os';

export const keycloakConfig = {
  url: env.KC_URL,
  realm: env.KC_REALM,
  clientId: env.KC_CLIENT_ID,
  clientSecret: env.KC_CLIENT_SECRET,
} as const;

export interface NodeConfig {
  host: string;
  port: number;
  httpsOptions: HttpsOptions | undefined;
  nodeEnv: string;
  tempo: string;
  protocoll: boolean;
  keysPath: string;
  keycloak: typeof keycloakConfig;
  logger: {
    logDefault: boolean;
    logDir: string;
    logFileName: string;
    logPretty: boolean;
    logLevel: string;
  };
  serviceName: string;
  kafkaUri: string;
}

export const nodeConfig: NodeConfig = {
  host: hostname(),
  port: env.PORT,
  httpsOptions,
  nodeEnv: env.NODE_ENV,
  tempo: env.TEMPO_URI,
  protocoll: env.HTTPS,
  keysPath: env.KEYS_PATH,
  keycloak: keycloakConfig,
  logger: {
    logDefault: env.LOG_DEFAULT,
    logDir: env.LOG_DIRECTORY,
    logFileName: env.LOG_FILE_DEFAULT_NAME,
    logPretty: env.LOG_PRETTY,
    logLevel: env.LOG_LEVEL,
  },
  serviceName: env.SERVICE,
  kafkaUri: env.KAFKA_BROKER,
};
