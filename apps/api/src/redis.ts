import Redis from 'ioredis';
import { config } from './config.js';

/** Primary client for commands and publishing */
export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

/** Dedicated subscriber client (enters subscriber mode) */
export const redisSub = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});
