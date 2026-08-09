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
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { groups } from '../db/schema/groups.js';
import { devices } from '../db/schema/devices.js';
import { pttSessions } from '../db/schema/ptt-sessions.js';
import { getOnlineUserIds } from '../ws/ws-manager.js';
import { DISPATCHER_LEVEL } from '@pushcomm/shared';

export async function statsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/stats/overview
  app.get('/overview', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };

    if (roleLevel < DISPATCHER_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const [[userStats], [groupStats], [deviceStats], [sessionStats]] = await Promise.all([
      db
        .select({
          totalUsers: sql<number>`count(*)::int`,
          activeUsers: sql<number>`count(*) filter (where ${users.isActive} = true)::int`,
        })
        .from(users)
        .where(and(eq(users.departmentId, departmentId), eq(users.isDeleted, false))),
      db
        .select({
          totalGroups: sql<number>`count(*)::int`,
        })
        .from(groups)
        .where(and(eq(groups.departmentId, departmentId), eq(groups.isDeleted, false))),
      db
        .select({
          totalDevices: sql<number>`count(*)::int`,
          activeDevices: sql<number>`count(*) filter (where ${devices.status} = 'active')::int`,
          pendingDevices: sql<number>`count(*) filter (where ${devices.status} = 'pending')::int`,
        })
        .from(devices)
        .where(and(eq(devices.departmentId, departmentId), eq(devices.isDeleted, false))),
      db
        .select({
          totalPttSessions: sql<number>`count(*)::int`,
          activePttSessions: sql<number>`count(*) filter (where ${pttSessions.endedAt} is null)::int`,
        })
        .from(pttSessions)
        .where(eq(pttSessions.departmentId, departmentId)),
    ]);

    const onlineUsers = getOnlineUserIds(departmentId).length;

    return {
      success: true,
      data: {
        totalUsers: userStats.totalUsers,
        activeUsers: userStats.activeUsers,
        totalGroups: groupStats.totalGroups,
        totalDevices: deviceStats.totalDevices,
        activeDevices: deviceStats.activeDevices,
        pendingDevices: deviceStats.pendingDevices,
        totalPttSessions: sessionStats.totalPttSessions,
        activePttSessions: sessionStats.activePttSessions,
        onlineUsers,
        // Backward-compatible aliases for older dashboard builds.
        totalCalls: sessionStats.totalPttSessions,
        activeCalls: sessionStats.activePttSessions,
        totalUnits: deviceStats.totalDevices,
      },
    };
  });

}
