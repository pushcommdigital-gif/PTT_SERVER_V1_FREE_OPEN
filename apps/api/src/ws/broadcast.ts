/*
 * PushComm Community Edition
 * Copyright (C) 2026 PushComm Digital
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
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
