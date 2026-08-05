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
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { redis } from '../redis.js';
import { config } from '../config.js';
import type { HealthResponse } from '@pushcomm/shared';

async function httpCheck(url: string, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    // Any HTTP response (even 401/404) means the server is reachable
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    let dbOk = false;
    let redisOk = false;
    let livekitOk = false;
    let martinOk = false;

    // Check database
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      app.log.error('Database health check failed');
    }

    // Check Redis
    try {
      await redis.ping();
      redisOk = true;
    } catch {
      app.log.error('Redis health check failed');
    }

    // Check LiveKit — convert ws(s):// to http(s):// and probe the root
    if (config.livekit.url) {
      const livekitHttpUrl = config.livekit.url
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://');
      try {
        const origin = new URL(livekitHttpUrl).origin;
        livekitOk = await httpCheck(origin);
      } catch {
        // malformed URL — leave false
      }
    }

    // Check Martin tile server
    martinOk = await httpCheck(`${config.martin.url}/catalog`);

    const status = dbOk && redisOk ? 'ok' : 'degraded';

    const response: HealthResponse = {
      status,
      version: '1.0.0',
      uptime: process.uptime(),
      services: {
        database: dbOk,
        redis: redisOk,
        livekit: livekitOk,
        martin: martinOk,
      },
    };

    reply.code(status === 'ok' ? 200 : 503).send(response);
  });
}
