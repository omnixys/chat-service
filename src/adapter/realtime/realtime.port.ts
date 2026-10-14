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

import type { MessageCreatedEvent } from './realtime.events.js';
import type { Observable } from 'rxjs';

export const REALTIME_PUBLISHER = Symbol('REALTIME_PUBLISHER');

/**
 * Transport agnostic realtime port.
 *
 * `subscribe` returns a cold observable that stays connected for as long as the
 * subscriber is attached and detaches on unsubscribe.
 */
export interface RealtimePublisher {
  publish(channel: string, event: MessageCreatedEvent): Promise<void>;
  subscribe(channel: string): Observable<MessageCreatedEvent>;
  health(): Promise<boolean>;
}
