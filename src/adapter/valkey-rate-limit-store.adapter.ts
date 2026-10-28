import { Injectable } from '@nestjs/common';
import { ValkeyService } from '@omnixys/cache-ts';
import { RateLimitStore } from '@omnixys/security-ts';

@Injectable()
export class ValkeyRateLimitStore implements RateLimitStore {
  constructor(private readonly valkey: ValkeyService) {}

  async ttl(key: string): Promise<number> {
    return this.valkey.ttl(key);
  }

  async incr(key: string): Promise<number> {
    return this.valkey.increment(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.valkey.expire(key, seconds);
  }
}
