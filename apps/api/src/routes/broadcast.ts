/*
 * PushComm Community Edition
 * Copyright (C) 2026 Corbani Mauro
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { FastifyInstance } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { config } from '../config.js';
import { eq } from 'drizzle-orm';

export async function broadcastRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // POST /api/broadcast/token - Generate a department-wide All Call room token.
  app.post('/token', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };

    if (!config.livekit.apiKey || !config.livekit.apiSecret) {
      return reply.code(503).send({ success: false, error: 'LiveKit is not configured' });
    }

    const [user] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);

    const participantName = user ? `${user.firstName} ${user.lastName}` : sub;
    const roomName = `broadcast-${departmentId}`;

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: sub,
      name: participantName,
      ttl: '24h',
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return {
      success: true,
      data: {
        token,
        livekitUrl: config.livekit.publicUrl,
        roomName,
      },
    };
  });
}
