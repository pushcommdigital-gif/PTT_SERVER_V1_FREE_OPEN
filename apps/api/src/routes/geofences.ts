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
import { db } from '../db/index.js';
import { geofences } from '../db/schema/geofences.js';
import { broadcast } from '../ws/broadcast.js';
import { DISPATCHER_LEVEL } from '@pushcomm/shared';

function canManageZones(user: unknown): boolean {
  const roleLevel = (user as { roleLevel?: number } | undefined)?.roleLevel ?? 0;
  return roleLevel >= DISPATCHER_LEVEL;
}

export async function geofenceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/geofences — list all fences for the department
  app.get<{ Querystring: { active?: string } }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const { active } = request.query;

    const conditions = [eq(geofences.departmentId, departmentId)];
    if (active === 'true') conditions.push(eq(geofences.active, true));
    if (active === 'false') conditions.push(eq(geofences.active, false));

    const rows = await db
      .select()
      .from(geofences)
      .where(and(...conditions))
      .orderBy(geofences.createdAt);

    return { success: true, data: rows };
  });

  // POST /api/geofences — create a new fence
  app.post<{
    Body: { name: string; coordinates: [number, number][]; assignedUserIds?: string[] | null };
  }>('/', async (request, reply) => {
    if (!canManageZones(request.user)) return reply.code(403).send({ success: false, error: 'Dispatcher access required' });

    const { departmentId } = request.user as { departmentId: string };
    const { name, coordinates, assignedUserIds } = request.body;

    if (!name?.trim()) {
      return reply.code(400).send({ success: false, error: 'name is required' });
    }
    if (!Array.isArray(coordinates) || coordinates.length < 3) {
      return reply.code(400).send({ success: false, error: 'coordinates must have at least 3 points' });
    }

    const [fence] = await db
      .insert(geofences)
      .values({ departmentId, name: name.trim(), coordinates, assignedUserIds: assignedUserIds ?? null })
      .returning();

    broadcast(departmentId, { event: 'geofence:updated', timestamp: new Date().toISOString() });

    return { success: true, data: fence };
  });

  // PATCH /api/geofences/:id — update name / coordinates / active / assignedUserIds
  app.patch<{
    Params: { id: string };
    Body: { name?: string; coordinates?: [number, number][]; active?: boolean; assignedUserIds?: string[] | null };
  }>('/:id', async (request, reply) => {
    if (!canManageZones(request.user)) return reply.code(403).send({ success: false, error: 'Dispatcher access required' });

    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;
    const { name, coordinates, active, assignedUserIds } = request.body;

    if (coordinates !== undefined && (!Array.isArray(coordinates) || coordinates.length < 3)) {
      return reply.code(400).send({ success: false, error: 'coordinates must have at least 3 points' });
    }

    const [existing] = await db
      .select({ id: geofences.id, departmentId: geofences.departmentId })
      .from(geofences)
      .where(eq(geofences.id, id))
      .limit(1);

    if (!existing) return reply.code(404).send({ success: false, error: 'Geofence not found' });
    if (existing.departmentId !== departmentId) return reply.code(403).send({ success: false, error: 'Forbidden' });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (coordinates !== undefined) updates.coordinates = coordinates;
    if (active !== undefined) updates.active = active;
    // null → clear assignments (all users); array → set specific users
    if (assignedUserIds !== undefined) updates.assignedUserIds = assignedUserIds;

    const [updated] = await db
      .update(geofences)
      .set(updates)
      .where(eq(geofences.id, id))
      .returning();

    broadcast(departmentId, { event: 'geofence:updated', timestamp: new Date().toISOString() });

    return { success: true, data: updated };
  });

  // DELETE /api/geofences/:id
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    if (!canManageZones(request.user)) return reply.code(403).send({ success: false, error: 'Dispatcher access required' });

    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [existing] = await db
      .select({ id: geofences.id, departmentId: geofences.departmentId })
      .from(geofences)
      .where(eq(geofences.id, id))
      .limit(1);

    if (!existing) return reply.code(404).send({ success: false, error: 'Geofence not found' });
    if (existing.departmentId !== departmentId) return reply.code(403).send({ success: false, error: 'Forbidden' });

    await db.delete(geofences).where(eq(geofences.id, id));

    broadcast(departmentId, { event: 'geofence:updated', timestamp: new Date().toISOString() });

    return { success: true };
  });
}
