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
import { eq, and, ilike, asc, desc, sql, or, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { calls } from '../db/schema/calls.js';
import { callNotes } from '../db/schema/call-notes.js';
import { callDispatches } from '../db/schema/call-dispatches.js';
import { users } from '../db/schema/users.js';
import { groups } from '../db/schema/groups.js';
import { units } from '../db/schema/units.js';
import { unitStates } from '../db/schema/unit-states.js';
import { CALL_PRIORITIES, CALL_STATES, DISPATCH_TYPES } from '@pushcomm/shared';
import { broadcast } from '../ws/broadcast.js';

export async function callRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/calls — List calls with pagination, search, state/priority filters
  app.get<{
    Querystring: { page?: string; limit?: string; search?: string; state?: string; priority?: string };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const search = request.query.search?.trim();
    const stateFilter = request.query.state;
    const priorityFilter = request.query.priority;

    const conditions: any[] = [eq(calls.departmentId, departmentId)];

    if (stateFilter && CALL_STATES.includes(stateFilter as any)) {
      conditions.push(eq(calls.state, stateFilter));
    }

    if (priorityFilter && CALL_PRIORITIES.includes(priorityFilter as any)) {
      conditions.push(eq(calls.priority, priorityFilter));
    }

    if (search) {
      conditions.push(
        or(
          ilike(calls.name, `%${search}%`),
          ilike(calls.nature, `%${search}%`),
          ilike(calls.address, `%${search}%`),
        )!,
      );
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(calls)
      .where(whereClause);

    const reportedByUser = db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .as('reported_by_user');

    const result = await db
      .select({
        id: calls.id,
        number: calls.number,
        name: calls.name,
        nature: calls.nature,
        priority: calls.priority,
        type: calls.type,
        state: calls.state,
        address: calls.address,
        source: calls.source,
        dispatchCount: calls.dispatchCount,
        createdAt: calls.createdAt,
        updatedAt: calls.updatedAt,
        closedAt: calls.closedAt,
        reportedByFirstName: reportedByUser.firstName,
        reportedByLastName: reportedByUser.lastName,
      })
      .from(calls)
      .leftJoin(reportedByUser, eq(calls.reportedBy, reportedByUser.id))
      .where(whereClause)
      .orderBy(desc(calls.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: result,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  });

  // GET /api/calls/:id — Full call detail with notes + dispatches
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [call] = await db
      .select()
      .from(calls)
      .where(and(eq(calls.id, id), eq(calls.departmentId, departmentId)))
      .limit(1);

    if (!call) {
      return reply.code(404).send({ success: false, error: 'Call not found' });
    }

    // Fetch notes with user info
    const noteUser = db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .as('note_user');

    const notes = await db
      .select({
        id: callNotes.id,
        note: callNotes.note,
        createdAt: callNotes.createdAt,
        userFirstName: noteUser.firstName,
        userLastName: noteUser.lastName,
      })
      .from(callNotes)
      .leftJoin(noteUser, eq(callNotes.userId, noteUser.id))
      .where(eq(callNotes.callId, id))
      .orderBy(desc(callNotes.createdAt));

    // Fetch dispatches with dispatched-by user info
    const dispatchUser = db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .as('dispatch_user');

    const dispatches = await db
      .select({
        id: callDispatches.id,
        dispatchType: callDispatches.dispatchType,
        targetId: callDispatches.targetId,
        dispatchedAt: callDispatches.dispatchedAt,
        acknowledgedAt: callDispatches.acknowledgedAt,
        onSceneAt: callDispatches.onSceneAt,
        clearedAt: callDispatches.clearedAt,
        dispatchedByFirstName: dispatchUser.firstName,
        dispatchedByLastName: dispatchUser.lastName,
      })
      .from(callDispatches)
      .leftJoin(dispatchUser, eq(callDispatches.dispatchedBy, dispatchUser.id))
      .where(eq(callDispatches.callId, id))
      .orderBy(desc(callDispatches.dispatchedAt));

    const userTargetIds = dispatches.filter((d) => d.dispatchType === 'user').map((d) => d.targetId);
    const groupTargetIds = dispatches.filter((d) => d.dispatchType === 'group').map((d) => d.targetId);
    const unitTargetIds = dispatches.filter((d) => d.dispatchType === 'unit').map((d) => d.targetId);

    const [userTargets, groupTargets, unitTargets] = await Promise.all([
      userTargetIds.length > 0
        ? db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, userTargetIds))
        : Promise.resolve([]),
      groupTargetIds.length > 0
        ? db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, groupTargetIds))
        : Promise.resolve([]),
      unitTargetIds.length > 0
        ? db.select({ id: units.id, name: units.name }).from(units).where(inArray(units.id, unitTargetIds))
        : Promise.resolve([]),
    ]);

    const userLabelById = new Map(userTargets.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()]));
    const groupLabelById = new Map(groupTargets.map((g) => [g.id, g.name]));
    const unitLabelById = new Map(unitTargets.map((u) => [u.id, u.name]));

    const dispatchesWithLabels = dispatches.map((d) => {
      let targetLabel = d.dispatchType;
      if (d.dispatchType === 'user') {
        targetLabel = userLabelById.get(d.targetId) || 'User';
      } else if (d.dispatchType === 'group') {
        targetLabel = groupLabelById.get(d.targetId) || 'Group';
      } else if (d.dispatchType === 'unit') {
        targetLabel = unitLabelById.get(d.targetId) || 'Unit';
      }
      return { ...d, targetLabel };
    });

    return { success: true, data: { ...call, notes, dispatches: dispatchesWithLabels } };
  });

  // POST /api/calls — Create call
  app.post<{
    Body: {
      name: string;
      nature?: string;
      priority?: string;
      type?: string;
      address?: string;
      latitude?: string;
      longitude?: string;
      w3w?: string;
      source?: string;
    };
  }>('/', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { name, nature, priority, type, address, latitude, longitude, w3w, source } = request.body;

    if (!name) {
      return reply.code(400).send({ success: false, error: 'Name is required' });
    }

    const [created] = await db
      .insert(calls)
      .values({
        departmentId,
        name,
        nature,
        priority: priority || 'medium',
        type,
        address,
        latitude,
        longitude,
        w3w,
        source,
        reportedBy: sub,
      })
      .returning();

    broadcast(departmentId, { event: 'call:created', callId: created.id, name: created.name, priority: created.priority, timestamp: new Date().toISOString() });
    return reply.code(201).send({ success: true, data: created });
  });

  // PATCH /api/calls/:id — Update call
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      nature?: string;
      priority?: string;
      type?: string;
      state?: string;
      address?: string;
      latitude?: string;
      longitude?: string;
      w3w?: string;
    };
  }>('/:id', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;
    const body = request.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const key of ['name', 'nature', 'priority', 'type', 'state', 'address', 'latitude', 'longitude', 'w3w'] as const) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    const [updated] = await db
      .update(calls)
      .set(updates)
      .where(and(eq(calls.id, id), eq(calls.departmentId, departmentId)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Call not found' });
    }

    broadcast(departmentId, { event: 'call:updated', callId: updated.id, timestamp: new Date().toISOString() });
    return { success: true, data: updated };
  });

  // POST /api/calls/:id/close — Close a call
  app.post<{ Params: { id: string } }>('/:id/close', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { id } = request.params;

    const [updated] = await db
      .update(calls)
      .set({ state: 'closed', closedBy: sub, closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(calls.id, id), eq(calls.departmentId, departmentId), eq(calls.state, 'active')))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Active call not found' });
    }

    broadcast(departmentId, { event: 'call:closed', callId: updated.id, closedBy: sub, timestamp: new Date().toISOString() });
    return { success: true, data: updated };
  });

  // POST /api/calls/:id/notes — Add note to call
  app.post<{
    Params: { id: string };
    Body: { note: string };
  }>('/:id/notes', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { id } = request.params;
    const { note } = request.body;

    if (!note?.trim()) {
      return reply.code(400).send({ success: false, error: 'Note is required' });
    }

    // Verify call belongs to department
    const [call] = await db
      .select({ id: calls.id })
      .from(calls)
      .where(and(eq(calls.id, id), eq(calls.departmentId, departmentId)))
      .limit(1);

    if (!call) {
      return reply.code(404).send({ success: false, error: 'Call not found' });
    }

    const [created] = await db
      .insert(callNotes)
      .values({ callId: id, userId: sub, note: note.trim() })
      .returning();

    broadcast(departmentId, { event: 'call:note_added', callId: id, timestamp: new Date().toISOString() });
    return reply.code(201).send({ success: true, data: created });
  });

  // POST /api/calls/:id/dispatch — Dispatch to user/group/unit
  app.post<{
    Params: { id: string };
    Body: { dispatchType: string; targetId: string };
  }>('/:id/dispatch', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { id } = request.params;
    const { dispatchType, targetId } = request.body;

    if (!dispatchType || !targetId) {
      return reply.code(400).send({ success: false, error: 'dispatchType and targetId are required' });
    }

    if (!DISPATCH_TYPES.includes(dispatchType as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid dispatch type' });
    }

    // Verify call belongs to department
    const [call] = await db
      .select({ id: calls.id })
      .from(calls)
      .where(and(eq(calls.id, id), eq(calls.departmentId, departmentId)))
      .limit(1);

    if (!call) {
      return reply.code(404).send({ success: false, error: 'Call not found' });
    }

    const [dispatch] = await db
      .insert(callDispatches)
      .values({ callId: id, dispatchType, targetId, dispatchedBy: sub })
      .returning();

    // Increment dispatch count
    await db
      .update(calls)
      .set({
        dispatchCount: sql`${calls.dispatchCount} + 1`,
        lastDispatchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(calls.id, id));

    broadcast(departmentId, { event: 'call:dispatched', callId: id, dispatchType, targetId, timestamp: new Date().toISOString() });
    return reply.code(201).send({ success: true, data: dispatch });
  });

  // POST /api/calls/:id/dispatches/:dispatchId/clear — Clear/remove a sent resource
  app.post<{ Params: { id: string; dispatchId: string } }>('/:id/dispatches/:dispatchId/clear', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { id, dispatchId } = request.params;

    const [call] = await db
      .select({ id: calls.id })
      .from(calls)
      .where(and(eq(calls.id, id), eq(calls.departmentId, departmentId)))
      .limit(1);

    if (!call) {
      return reply.code(404).send({ success: false, error: 'Call not found' });
    }

    const [dispatch] = await db
      .select({
        id: callDispatches.id,
        dispatchType: callDispatches.dispatchType,
        targetId: callDispatches.targetId,
        clearedAt: callDispatches.clearedAt,
      })
      .from(callDispatches)
      .where(and(eq(callDispatches.id, dispatchId), eq(callDispatches.callId, id)))
      .limit(1);

    if (!dispatch) {
      return reply.code(404).send({ success: false, error: 'Dispatch entry not found' });
    }

    if (dispatch.clearedAt) {
      return { success: true, data: dispatch };
    }

    const [cleared] = await db
      .update(callDispatches)
      .set({ clearedAt: new Date() })
      .where(eq(callDispatches.id, dispatchId))
      .returning();

    if (dispatch.dispatchType === 'unit') {
      const [unit] = await db
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.id, dispatch.targetId), eq(units.departmentId, departmentId), eq(units.isDeleted, false)))
        .limit(1);

      if (unit) {
        await db.insert(unitStates).values({
          unitId: unit.id,
          state: 'in_service',
          note: `Cleared from call ${id}`,
          changedBy: sub,
        });
        broadcast(departmentId, { event: 'unit:updated', unitId: unit.id, timestamp: new Date().toISOString() });
      }
    }

    broadcast(departmentId, { event: 'call:updated', callId: id, timestamp: new Date().toISOString() });
    return { success: true, data: cleared };
  });
}
