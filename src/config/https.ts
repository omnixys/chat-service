import { env } from './env.js';
import type { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tlsDir = resolve(env.KEYS_PATH);

export const httpsOptions: HttpsOptions | undefined = env.HTTPS
  ? {
      key: readFileSync(resolve(tlsDir, 'key.pem')),
      cert: readFileSync(resolve(tlsDir, 'certificate.crt')),
    }
  : undefined;
