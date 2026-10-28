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

import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Body of `POST /api/v1/internal/inbound-message`.
 *
 * Field names are the snake_case provider contract. The Python service declared
 * the sender address as `from_` because `from` is reserved in Python, and the
 * Pydantic model shipped it under that name; both spellings are accepted here so a
 * provider that was already integrated against either one keeps working.
 */
export class InboundMessageDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  message_id!: string;

  @Transform(upper)
  @IsString()
  @IsIn(['WHATSAPP', 'IN_APP'])
  channel!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  user_id?: string;

  @ValidateIf((dto: InboundMessageDto) => dto.from_ === undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  from?: string;

  @ValidateIf((dto: InboundMessageDto) => dto.from === undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  from_?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64_000)
  body?: string;

  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(20)
  content_type?: string;

  @IsOptional()
  @IsUUID()
  conversation_id?: string;

  get senderAddress(): string | undefined {
    return this.from ?? this.from_;
  }
}

/** Body of `POST /api/v1/internal/delivery-status`. */
export class DeliveryStatusDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  provider_message_id!: string;

  @IsOptional()
  @IsUUID()
  internal_message_id?: string;

  @IsOptional()
  @IsUUID()
  conversation_id?: string;

  @Transform(upper)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  error?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timestamp?: string | null;
}

export interface InboundMessageResponse {
  readonly id: string;
  readonly conversation_id: string;
  readonly sender_id: string;
  readonly body: string;
  readonly channel: string;
  readonly delivery_status: string;
  readonly created_at: string;
  readonly duplicate: boolean;
}

export interface DeliveryStatusResponse {
  readonly id: string;
  readonly status: string;
}
