import { env, validateProductionSettings } from './env.js';
import { nodeConfig } from './node.js';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  displayLogEnvValue,
  getLogEnvSection,
  LOG_ENV_SECTION_ORDER,
  OmnixysLogger,
  type LogEnvSection,
  type ScopedLogger,
} from '@omnixys/logger-ts';
import { release, type, userInfo } from 'node:os';
import process from 'node:process';

@Injectable()
export class BannerService implements OnApplicationBootstrap {
  readonly #logger: ScopedLogger;

  constructor(@Inject(OmnixysLogger) logger: OmnixysLogger) {
    this.#logger = logger.log(this.constructor.name);
  }

  onApplicationBootstrap(): void {
    validateProductionSettings();
    const { host, nodeEnv, port, protocoll, keysPath, logger, serviceName } = nodeConfig;

    this.#generateBanner(serviceName);
    this.#logger.info('=== Anwendungsinformationen ===');
    this.#logger.info(`Anwendungsname: ${serviceName}`);
    this.#logger.info(`Node.js-Version: ${process.version}`);
    this.#logger.info(`Umgebung: ${nodeEnv}`);
    this.#logger.info(`Host: ${host}`);
    this.#logger.info(`Port: ${port}`);
    this.#logger.info(`Betriebssystem: ${type()} (${release()})`);
    this.#logger.info(`Benutzer: ${userInfo().username}`);
    this.#logger.info(`HTTPS: ${protocoll}`);
    this.#logger.info(`Keys path: ${keysPath}`);
    this.#logger.info('===============LOGGER============');

    if (logger.logDefault) {
      this.#logger.info('Default Logger!');
    } else {
      this.#logger.info(`Log Directory: ${logger.logDir}`);
      this.#logger.info(`Log Filename: ${logger.logFileName}`);
      this.#logger.info(`Pretty Logging: ${logger.logPretty}`);
      this.#logger.info(`Custom Log Level: ${logger.logLevel}`);
    }

    this.#printEnv();
    this.#logger.info('===============================');
  }

  #printEnv(): void {
    const groups = new Map<LogEnvSection, Array<[string, string]>>();
    for (const section of LOG_ENV_SECTION_ORDER) {
      groups.set(section, []);
    }

    for (const [key, value] of Object.entries(env)) {
      if (
        key.startsWith('LOG_') ||
        ['NODE_ENV', 'PORT', 'SERVICE', 'HTTPS', 'KEYS_PATH'].includes(key)
      ) {
        continue;
      }
      groups.get(getLogEnvSection(key))?.push([key, String(value)]);
    }

    for (const section of LOG_ENV_SECTION_ORDER) {
      const entries = groups.get(section);
      if (entries === undefined || entries.length === 0) {
        continue;
      }
      this.#logger.info(`==============${section}===========`);
      for (const [key, value] of entries) {
        this.#logger.info(
          `${key}: ${displayLogEnvValue(key, value, { nodeEnv: nodeConfig.nodeEnv })}`,
        );
      }
    }
  }

  #generateBanner(serviceName: string): void {
    this.#logger.info(`=== ${serviceName} ===`);
  }
}
