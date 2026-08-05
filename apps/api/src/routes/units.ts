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
import { eq, and, ilike, asc, desc, sql, or, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { units } from '../db/schema/units.js';
import { groups } from '../db/schema/groups.js';
import { calls } from '../db/schema/calls.js';
import { callDispatches } from '../db/schema/call-dispatches.js';
import { unitStates } from '../db/schema/unit-states.js';
import { ADMIN_LEVEL, DISPATCHER_LEVEL, UNIT_STATES } from '@pushcomm/shared';
import { broadcast } from '../ws/broadcast.js';

export async function unitRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/units — List units with pagination, search, station filter
  app.get<{
    Querystring: { page?: string; limit?: string; search?: string; stationGroupId?: string };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const search = request.query.search?.trim();
    const stationFilter = request.query.stationGroupId;

    const conditions: any[] = [eq(units.departmentId, departmentId), eq(units.isDeleted, false)];

    if (stationFilter) {
      conditions.push(eq(units.stationGroupId, stationFilter));
    }

    if (search) {
      conditions.push(
        or(
          ilike(units.name, `%${search}%`),
          ilike(units.plateNumber, `%${search}%`),
          ilike(units.type, `%${search}%`),
        )!,
      );
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(units)
      .where(whereClause);

    const stationGroup = db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .as('station_group');

    const result = await db
      .select({
        id: units.id,
        departmentId: units.departmentId,
        stationGroupId: units.stationGroupId,
        name: units.name,
        type: units.type,
        plateNumber: units.plateNumber,
        vin: units.vin,
        createdAt: units.createdAt,
        stationName: stationGroup.name,
      })
      .from(units)
      .leftJoin(stationGroup, eq(units.stationGroupId, stationGroup.id))
      .where(whereClause)
      .orderBy(asc(units.name))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: result,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  });

  // GET /api/units/availability — Units grouped by availability for dispatch console
  app.get('/availability', async (request) => {
    const { departmentId } = request.user as { departmentId: string };

    const unitList = await db
      .select({
        id: units.id,
        name: units.name,
        type: units.type,
        stationGroupId: units.stationGroupId,
      })
      .from(units)
      .where(and(eq(units.departmentId, departmentId), eq(units.isDeleted, false)))
      .orderBy(asc(units.name));

    if (unitList.length === 0) {
      return {
        success: true,
        data: { available: [], unavailable: [], onCall: [], counts: { available: 0, unavailable: 0, onCall: 0 } },
      };
    }

    const unitIds = unitList.map((u) => u.id);

    const activeUnitDispatches = await db
      .select({ targetId: callDispatches.targetId })
      .from(callDispatches)
      .innerJoin(calls, eq(callDispatches.callId, calls.id))
      .where(
        and(
          eq(calls.departmentId, departmentId),
          eq(calls.state, 'active'),
          eq(callDispatches.dispatchType, 'unit'),
          isNull(callDispatches.clearedAt),
          inArray(callDispatches.targetId, unitIds),
        ),
      );

    const latestStates = await db
      .select({
        unitId: unitStates.unitId,
        state: unitStates.state,
        timestamp: unitStates.timestamp,
      })
      .from(unitStates)
      .where(inArray(unitStates.unitId, unitIds))
      .orderBy(desc(unitStates.timestamp));

    const onCallUnitIds = new Set(activeUnitDispatches.map((d) => d.targetId));
    const latestStateByUnit = new Map<string, string>();
    for (const entry of latestStates) {
      if (!latestStateByUnit.has(entry.unitId)) {
        latestStateByUnit.set(entry.unitId, entry.state);
      }
    }

    const available: Array<Record<string, any>> = [];
    const unavailable: Array<Record<string, any>> = [];
    const onCall: Array<Record<string, any>> = [];

    for (const unit of unitList) {
      const currentState = latestStateByUnit.get(unit.id) || 'in_service';
      const mapped = { ...unit, currentState };

      if (onCallUnitIds.has(unit.id)) {
        onCall.push(mapped);
      } else if (currentState === 'out_of_service' || currentState === 'maintenance') {
        unavailable.push(mapped);
      } else {
        available.push(mapped);
      }
    }

    return {
      success: true,
      data: {
        available,
        unavailable,
        onCall,
        counts: { available: available.length, unavailable: unavailable.length, onCall: onCall.length },
      },
    };
  });

  // GET /api/units/:id
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [unit] = await db
      .select()
      .from(units)
      .where(and(eq(units.id, id), eq(units.departmentId, departmentId), eq(units.isDeleted, false)))
      .limit(1);

    if (!unit) {
      return reply.code(404).send({ success: false, error: 'Unit not found' });
    }

    return { success: true, data: unit };
  });

  // POST /api/units — Create unit (admin+)
  app.post<{
    Body: {
      name: string;
      type?: string;
      plateNumber?: string;
      vin?: string;
      stationGroupId?: string;
    };
  }>('/', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { name, type, plateNumber, vin, stationGroupId } = request.body;

    if (!name) {
      return reply.code(400).send({ success: false, error: 'Name is required' });
    }

    const [created] = await db
      .insert(units)
      .values({
        departmentId,
        name,
        type: type || null,
        plateNumber: plateNumber || null,
        vin: vin || null,
        stationGroupId: stationGroupId || null,
      })
      .returning();

    broadcast(departmentId, { event: 'unit:created', unitId: created.id, timestamp: new Date().toISOString() });
    return reply.code(201).send({ success: true, data: created });
  });

  // PATCH /api/units/:id — Update unit
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      type?: string;
      plateNumber?: string;
      vin?: string;
      stationGroupId?: string | null;
    };
  }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;
    const body = request.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const key of ['name', 'type', 'plateNumber', 'vin', 'stationGroupId'] as const) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    const [updated] = await db
      .update(units)
      .set(updates)
      .where(and(eq(units.id, id), eq(units.departmentId, departmentId), eq(units.isDeleted, false)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Unit not found' });
    }

    broadcast(departmentId, { event: 'unit:updated', unitId: updated.id, timestamp: new Date().toISOString() });
    return { success: true, data: updated };
  });

  // POST /api/units/:id/state — Append unit state entry (dispatcher+)
  app.post<{
    Params: { id: string };
    Body: { state: string; note?: string };
  }>('/:id/state', async (request, reply) => {
    const { sub, roleLevel, departmentId } = request.user as { sub: string; roleLevel: number; departmentId: string };
    const { id } = request.params;
    const { state, note } = request.body || {};

    if (roleLevel < DISPATCHER_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    if (!state || !UNIT_STATES.includes(state as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid unit state' });
    }

    const [unit] = await db
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.id, id), eq(units.departmentId, departmentId), eq(units.isDeleted, false)))
      .limit(1);

    if (!unit) {
      return reply.code(404).send({ success: false, error: 'Unit not found' });
    }

    const [entry] = await db
      .insert(unitStates)
      .values({
        unitId: id,
        state,
        note: note?.trim() || null,
        changedBy: sub,
      })
      .returning();

    broadcast(departmentId, { event: 'unit:updated', unitId: id, timestamp: new Date().toISOString() });
    return reply.code(201).send({ success: true, data: entry });
  });

  // DELETE /api/units/:id — Soft delete
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;

    const [deleted] = await db
      .update(units)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(eq(units.id, id), eq(units.departmentId, departmentId), eq(units.isDeleted, false)))
      .returning({ id: units.id });

    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'Unit not found' });
    }

    broadcast(departmentId, { event: 'unit:deleted', unitId: id, timestamp: new Date().toISOString() });
    return { success: true, message: 'Unit deleted' };
  });
}
