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
import { eq, and } from 'drizzle-orm';
import { AccessToken } from 'livekit-server-sdk';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { config } from '../config.js';
import { broadcast } from '../ws/broadcast.js';
import { sendFcm } from '../services/fcm.js';

export async function privateCallRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // POST /api/private-calls/token
  // Generates a LiveKit token for a private 1-to-1 room.
  // If notify=true, broadcasts private_call:incoming to signal the target user.
  app.post<{
    Body: { targetUserId: string; notify?: boolean };
  }>('/token', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { targetUserId, notify } = request.body;

    if (!targetUserId) {
      return reply.code(400).send({ success: false, error: 'targetUserId is required' });
    }
    if (targetUserId === sub) {
      return reply.code(400).send({ success: false, error: 'Cannot call yourself' });
    }
    if (!config.livekit.apiKey || !config.livekit.apiSecret) {
      return reply.code(503).send({ success: false, error: 'LiveKit is not configured' });
    }

    // Validate target user exists in same department
    const [targetUser] = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, fcmToken: users.fcmToken })
      .from(users)
      .where(and(eq(users.id, targetUserId), eq(users.departmentId, departmentId)))
      .limit(1);

    if (!targetUser) {
      return reply.code(404).send({ success: false, error: 'User not found' });
    }

    // Caller's name for the notification payload
    const [callerUser] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);

    // Deterministic room name — both sides compute the same string
    const roomName = 'private-' + [sub, targetUserId].sort().join('-');

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: sub,
      name: callerUser ? `${callerUser.firstName} ${callerUser.lastName}` : sub,
      ttl: '24h',
    });
    at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });

    const token = await at.toJwt();

    if (notify) {
      broadcast(departmentId, {
        event: 'private_call:incoming',
        initiatorId: sub,
        initiatorFirstName: callerUser?.firstName ?? '',
        initiatorLastName: callerUser?.lastName ?? '',
        targetUserId,
        roomName,
        timestamp: new Date().toISOString(),
      });

      if (targetUser.fcmToken) {
        sendFcm([targetUser.fcmToken], {
          type: 'private_call',
          initiatorId: sub,
          initiatorName: callerUser ? `${callerUser.firstName} ${callerUser.lastName}`.trim() : sub,
          roomName,
        });
      }
    }

    return {
      success: true,
      data: {
        token,
        livekitUrl: config.livekit.publicUrl,
        roomName,
        targetFirstName: targetUser.firstName,
        targetLastName: targetUser.lastName,
      },
    };
  });

  // POST /api/private-calls/end
  // Signals the target user that the private call has ended.
  app.post<{
    Body: { targetUserId: string };
  }>('/end', async (request) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { targetUserId } = request.body;
    const roomName = 'private-' + [sub, targetUserId].sort().join('-');

    broadcast(departmentId, {
      event: 'private_call:ended',
      endedBy: sub,
      targetUserId,
      roomName,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  });
}
