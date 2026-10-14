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

import { env } from '../../config/env.js';
import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export const INTERNAL_API_KEY_HEADER = 'x-api-key';

/**
 * Authenticates service-to-service calls on `/api/v1/internal/**`.
 *
 * The comparison is constant time so a wrong key cannot be discovered by timing
 * the response. The endpoint is marked `@Public()` so the global identity guard
 * does not reject a machine call that legitimately has no user token; this guard
 * is the only authentication for these routes and it fails closed when no key is
 * configured.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = env.INTERNAL_GATEWAY_TOKEN;
    if (expected === '') {
      // A missing key is a misconfiguration, not a client error, but it must still
      // never fall through to `204`. `401` tells the gateway "dependency
      // unavailable" instead of "the user may read this conversation".
      throw new UnauthorizedException({
        code: 'INTERNAL_API_KEY_NOT_CONFIGURED',
      });
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const presented = headerValue(request.headers[INTERNAL_API_KEY_HEADER]);
    if (presented === '') {
      throw new UnauthorizedException({ code: 'INTERNAL_API_KEY_MISSING' });
    }
    if (!constantTimeEquals(presented, expected)) {
      throw new UnauthorizedException({ code: 'INTERNAL_API_KEY_INVALID' });
    }
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function constantTimeEquals(presented: string, expected: string): boolean {
  const presentedBuffer = Buffer.from(presented, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (presentedBuffer.length !== expectedBuffer.length) {
    // Compare against itself so the failure path costs the same as a mismatch of
    // equal length, then report the mismatch.
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return timingSafeEqual(presentedBuffer, expectedBuffer);
}
