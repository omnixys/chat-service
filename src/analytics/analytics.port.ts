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

export interface AnalyticsFact {
  readonly topic: string;
  readonly eventName: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly subjectId?: string | undefined;
  readonly tenantId: string;
  readonly correlationId?: string | undefined;
  readonly actorId?: string | undefined;
}

/**
 * Writes a domain fact into the transactional outbox. Implementations must write
 * inside the caller's transaction so a rolled back write also drops the fact.
 */
export interface AnalyticsFactWriter {
  enqueue(fact: AnalyticsFact): Promise<string>;
}
