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

/**
 * Structural Prisma error detection.
 *
 * Prisma always attaches a string `code` to its client errors. Matching on that
 * code instead of `instanceof PrismaClientKnownRequestError` keeps the
 * application services free of the generated client, so they stay unit testable
 * without a database.
 */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_RECORD_NOT_FOUND = 'P2025';

function prismaCode(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) {
    return null;
  }
  const code: unknown = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function isPrismaError(cause: unknown, code: string): boolean {
  return prismaCode(cause) === code;
}

export function isUniqueViolation(cause: unknown): boolean {
  return isPrismaError(cause, PRISMA_UNIQUE_VIOLATION);
}
