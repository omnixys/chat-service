/**
 * @license GPL-3.0-or-later
 * Copyright (C) 2025 Caleb Gyamfi - Omnixys Technologies
 */

import { ErrorCode, FrameworkException } from '@omnixys/contracts-ts';

/** Reject requests without a verified tenant before any data access. */
export function verifiedTenantRequired(): FrameworkException {
  return new FrameworkException(ErrorCode.TENANT_CONTEXT_UNVERIFIED, {
    diagnostics: { required: 'verified-tenant-context' },
    httpStatus: 403,
  });
}

export function authenticationRequired(reason: string): FrameworkException {
  return new FrameworkException(ErrorCode.UNAUTHORIZED, {
    diagnostics: { reason },
    httpStatus: 401,
  });
}
