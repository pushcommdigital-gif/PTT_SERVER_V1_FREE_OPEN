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
