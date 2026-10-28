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

import {
  ANALYTICS_OUTBOX_PUBLISHER,
  AnalyticsOutboxPublisher,
} from '../analytics/analytics-outbox.js';
import { KafkaAnalyticsEventPublisher } from '../analytics/kafka-analytics.publisher.js';
import {
  CHANNEL_DELIVERY_ADAPTERS,
  GATEWAY_CHANNEL_CLIENT,
} from '../chat/ports/channel-adapters.token.js';
import {
  DEFAULT_DELIVERY_POLICY,
  defaultDeliveryPolicy,
} from '../chat/ports/delivery-policy.token.js';
import { InAppChannelAdapter, WhatsappChannelAdapter } from './channels/channel-adapters.js';
import { HttpGatewayChannelClient } from './gateway/gateway.client.js';
import { REALTIME_PUBLISHER } from './realtime/realtime.port.js';
import { ValkeyRealtimePublisher } from './realtime/valkey-realtime.publisher.js';
import { Module } from '@nestjs/common';

/**
 * Outbound side of the chat context: the gateway client, the channel adapters, the
 * realtime publisher and the analytics outbox.
 *
 * Everything is bound to a port token, so no application service imports a concrete
 * adapter. `CHANNEL_DELIVERY_ADAPTERS` is the only multi-provider and lists every
 * adapter the dispatcher may pick by channel. The analytics outbox publishes through
 * `ANALYTICS_OUTBOX_PUBLISHER`, which the Kafka adapter fulfils.
 */
@Module({
  providers: [
    HttpGatewayChannelClient,
    {
      provide: GATEWAY_CHANNEL_CLIENT,
      useExisting: HttpGatewayChannelClient,
    },

    InAppChannelAdapter,
    WhatsappChannelAdapter,
    {
      provide: CHANNEL_DELIVERY_ADAPTERS,
      useFactory: (
        inApp: InAppChannelAdapter,
        whatsapp: WhatsappChannelAdapter,
      ): readonly [InAppChannelAdapter, WhatsappChannelAdapter] => [inApp, whatsapp],
      inject: [InAppChannelAdapter, WhatsappChannelAdapter],
    },
    { provide: DEFAULT_DELIVERY_POLICY, useValue: defaultDeliveryPolicy },

    ValkeyRealtimePublisher,
    {
      provide: REALTIME_PUBLISHER,
      useExisting: ValkeyRealtimePublisher,
    },

    KafkaAnalyticsEventPublisher,
    {
      provide: ANALYTICS_OUTBOX_PUBLISHER,
      useExisting: KafkaAnalyticsEventPublisher,
    },
    AnalyticsOutboxPublisher,
  ],
  exports: [
    GATEWAY_CHANNEL_CLIENT,
    CHANNEL_DELIVERY_ADAPTERS,
    DEFAULT_DELIVERY_POLICY,
    REALTIME_PUBLISHER,
    ANALYTICS_OUTBOX_PUBLISHER,
    AnalyticsOutboxPublisher,
  ],
})
export class ChatAdaptersModule {}
