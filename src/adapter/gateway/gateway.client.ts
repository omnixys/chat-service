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

import type { Conversation } from '../../chat/models/entities/conversation.model.js';
import { type Message } from '../../chat/models/entities/message.model.js';
import {
  DeliveryStatus,
  isDeliveryStatus,
  type MessageContentType,
} from '../../chat/models/enums/message.enums.js';
import { env } from '../../config/env.js';
import { Injectable, Inject } from '@nestjs/common';
import { OmnixysLogger, type ScopedLogger } from '@omnixys/logger-ts';

const SEND_PATH = '/api/v1/messages/send';

/** Body accepted by the communication gateway. Field names are its contract. */
export interface GatewaySendRequest {
  readonly id: string;
  readonly channel: string;
  readonly recipientAddress: string | null;
  readonly senderId: string;
  readonly body: string;
  readonly contentType: MessageContentType;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface GatewaySendResponse {
  readonly success: boolean;
  readonly status: string;
  readonly providerMessageId?: string | null;
  readonly error?: string | null;
}

export interface GatewaySendOutcome {
  readonly success: boolean;
  readonly deliveryStatus: DeliveryStatus;
  readonly providerMessageId: string | null;
  readonly error: string | null;
}

export interface GatewayChannelClient {
  send(
    message: Message,
    conversation: Conversation,
  ): Promise<GatewaySendOutcome>;
  health(): Promise<boolean>;
}

/**
 * Client for the communication gateway's outbound send endpoint.
 *
 * Every transport level failure is mapped to `FAILED` with a classified reason
 * instead of being thrown, because a delivery failure must be recorded on the
 * message and must not abort the surrounding realtime fan-out.
 */
@Injectable()
export class HttpGatewayChannelClient implements GatewayChannelClient {
  private readonly logger: ScopedLogger;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(@Inject(OmnixysLogger) logger: OmnixysLogger) {
    this.logger = logger.log(this.constructor.name);
    this.baseUrl = env.GATEWAY_BASE_URL.replace(/\/+$/, '');
    this.apiKey = env.GATEWAY_API_KEY;
    this.timeoutMs = env.GATEWAY_TIMEOUT;
  }

  async send(
    message: Message,
    conversation: Conversation,
  ): Promise<GatewaySendOutcome> {
    const payload: GatewaySendRequest = {
      id: message.id,
      channel: message.channel,
      recipientAddress: conversation.externalAddress,
      senderId: message.senderId,
      body: message.body,
      contentType: message.contentType,
      metadata: { conversationId: conversation.id },
    };

    this.logger.info('gateway_outbound_start', {
      messageId: message.id,
      conversationId: conversation.id,
      channel: message.channel,
    });

    try {
      const response = await fetch(`${this.baseUrl}${SEND_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey === '' ? {} : { 'x-internal-api-key': this.apiKey }),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const data = (await response
        .json()
        .catch(() => ({}))) as Partial<GatewaySendResponse>;

      if (response.ok && data.success === true) {
        this.logger.info('gateway_outbound_accepted', {
          messageId: message.id,
          statusCode: response.status,
        });
        return {
          success: true,
          deliveryStatus: parseDeliveryStatus(data.status),
          providerMessageId: data.providerMessageId ?? null,
          error: null,
        };
      }

      return {
        success: false,
        deliveryStatus: DeliveryStatus.FAILED,
        providerMessageId: null,
        error: data.error ?? `HTTP ${response.status}`,
      };
    } catch (cause) {
      const reason = classifyTransportError(cause);
      this.logger.warn('gateway_outbound_failed', {
        messageId: message.id,
        conversationId: conversation.id,
        reason,
      });
      return {
        success: false,
        deliveryStatus: DeliveryStatus.FAILED,
        providerMessageId: null,
        error: reason,
      };
    }
  }

  async health(): Promise<boolean> {
    if (env.KEYCLOAK_HEALTH_URL !== '' || env.PROMETHEUS_HEALTH_URL !== '') {
      return true;
    }
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 5000)),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Defaults to `SENT` when the gateway reports success without a status, which is
 * the historical contract. An unknown status string is treated the same way
 * instead of failing a delivery the provider already accepted.
 */
function parseDeliveryStatus(value: string | undefined): DeliveryStatus {
  if (value === undefined || value === '') {
    return DeliveryStatus.SENT;
  }
  const candidate = value.toUpperCase();
  return isDeliveryStatus(candidate) ? candidate : DeliveryStatus.SENT;
}

function classifyTransportError(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'TimeoutError') {
    return 'gateway_timeout';
  }
  if (cause instanceof TypeError) {
    return 'gateway_unreachable';
  }
  return `gateway_error: ${cause instanceof Error ? cause.message : String(cause)}`;
}
