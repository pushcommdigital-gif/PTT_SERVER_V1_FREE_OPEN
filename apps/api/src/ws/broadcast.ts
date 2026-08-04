import { redis } from '../redis.js';
import type { WsEvent } from '@pushcomm/shared';

/**
 * Publish a WS event to all connections in a department.
 * Fire-and-forget — never blocks the HTTP response.
 */
export function broadcast(departmentId: string, event: WsEvent): void {
  const channel = `ws:dept:${departmentId}`;
  redis.publish(channel, JSON.stringify(event)).catch(() => {
    // Swallow errors — logging happens at the Redis client level
  });
}
