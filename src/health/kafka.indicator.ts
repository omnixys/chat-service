import { Injectable } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { KafkaLifecycleService } from '@omnixys/kafka-ts';
import { OmnixysLogger } from '@omnixys/logger-ts';

@Injectable()
export class KafkaIndicator {
  private readonly logger;

  constructor(
    private readonly kafka: KafkaLifecycleService,
    logger: OmnixysLogger,
  ) {
    this.logger = logger.log(this.constructor.name, 'service:chat');
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    const health = this.kafka.health();
    if (!health.healthy) {
      this.logger.error('Kafka health check failed: %o', { health });
    }
    return {
      kafka: {
        status: health.healthy ? 'up' : 'down',
        producer: health.producer.status,
        consumer: health.consumer.status,
      },
    };
  }
}
