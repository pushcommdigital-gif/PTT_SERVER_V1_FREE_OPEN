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
import { eq, and, gte, lte, desc, count, ilike, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { zoneAlerts } from '../db/schema/zone-alerts.js';
import { users } from '../db/schema/users.js';

const SUPER_ADMIN_LEVEL = 100;

export async function zoneAlertRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/zone-alerts — paginated archive, filterable
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      zoneType?: string;   // 'geofence' | 'poi'
      alertType?: string;  // 'enter' | 'exit'
      search?: string;     // matches zone name or user name
      from?: string;
      to?: string;
    };
  }>('/', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
    const limit = Math.min(100, parseInt(request.query.limit ?? '50', 10));
    const offset = (page - 1) * limit;
    const { zoneType, alertType, search, from, to } = request.query;

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(`${to}T23:59:59Z`) : null;

    // Build conditions
    const conditions = [eq(zoneAlerts.departmentId, departmentId)];
    if (zoneType === 'geofence' || zoneType === 'poi') conditions.push(eq(zoneAlerts.zoneType, zoneType));
    if (alertType === 'enter' || alertType === 'exit') conditions.push(eq(zoneAlerts.alertType, alertType));
    if (fromDate) conditions.push(gte(zoneAlerts.triggeredAt, fromDate));
    if (toDate) conditions.push(lte(zoneAlerts.triggeredAt, toDate));

    // If search, join users and filter on zone name OR user name
    const rows = await db
      .select({
        id: zoneAlerts.id,
        zoneType: zoneAlerts.zoneType,
        zoneId: zoneAlerts.zoneId,
        zoneName: zoneAlerts.zoneName,
        alertType: zoneAlerts.alertType,
        latitude: zoneAlerts.latitude,
        longitude: zoneAlerts.longitude,
        triggeredAt: zoneAlerts.triggeredAt,
        userId: zoneAlerts.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(zoneAlerts)
      .leftJoin(users, eq(zoneAlerts.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(zoneAlerts.triggeredAt))
      .limit(limit + 1)
      .offset(offset);

    // Apply search filter in-memory (zone name or user name)
    const filtered = search
      ? rows.filter((r) => {
          const q = search.toLowerCase();
          const fullName = `${r.firstName ?? ''} ${r.lastName ?? ''}`.toLowerCase();
          return r.zoneName.toLowerCase().includes(q) || fullName.includes(q) || (r.username ?? '').toLowerCase().includes(q);
        })
      : rows;

    const hasMore = filtered.length > limit;
    const data = filtered.slice(0, limit);

    // Total count for pagination
    const [{ total }] = await db
      .select({ total: count() })
      .from(zoneAlerts)
      .where(and(...conditions));

    return reply.send({
      success: true,
      data: data.map((r) => ({
        id: r.id,
        zoneType: r.zoneType,
        zoneId: r.zoneId,
        zoneName: r.zoneName,
        alertType: r.alertType,
        latitude: r.latitude,
        longitude: r.longitude,
        triggeredAt: r.triggeredAt,
        userId: r.userId,
        firstName: r.firstName ?? '',
        lastName: r.lastName ?? '',
        username: r.username ?? '',
      })),
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    });
  });

  // DELETE /api/zone-alerts/:id — Super Admin only
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };
    if ((roleLevel ?? 0) < SUPER_ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Super Admin required' });
    }
    await db
      .delete(zoneAlerts)
      .where(and(eq(zoneAlerts.id, request.params.id), eq(zoneAlerts.departmentId, departmentId)));
    return { success: true };
  });

  // DELETE /api/zone-alerts — bulk delete by date range, Super Admin only
  app.delete<{ Querystring: { from?: string; to?: string } }>('/', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };
    if ((roleLevel ?? 0) < SUPER_ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Super Admin required' });
    }
    const { from, to } = request.query;
    const conditions = [eq(zoneAlerts.departmentId, departmentId)];
    if (from) conditions.push(gte(zoneAlerts.triggeredAt, new Date(from)));
    if (to) conditions.push(lte(zoneAlerts.triggeredAt, new Date(`${to}T23:59:59Z`)));
    await db.delete(zoneAlerts).where(and(...conditions));
    return { success: true };
  });
}
