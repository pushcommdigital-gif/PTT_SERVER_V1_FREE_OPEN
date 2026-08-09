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
import { eq, and, desc, gte, lte, ilike, or, count, sql, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/index.js';
import { sosEvents } from '../db/schema/sos.js';
import { users } from '../db/schema/users.js';
import { locations } from '../db/schema/locations.js';
import { broadcast } from '../ws/broadcast.js';
import { sendFcm } from '../services/fcm.js';
import { DISPATCHER_LEVEL, ADMIN_LEVEL, SOS_DISPOSITIONS } from '@pushcomm/shared';

export async function sosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // POST /api/sos — trigger SOS (any authenticated user)
  app.post<{ Body: { latitude?: number; longitude?: number } }>('/', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    let { latitude, longitude } = request.body ?? {};

    const [activeExisting] = await db
      .select({ id: sosEvents.id })
      .from(sosEvents)
      .where(
        and(
          eq(sosEvents.departmentId, departmentId),
          eq(sosEvents.reportedBy, sub),
          eq(sosEvents.status, 'active'),
        ),
      )
      .orderBy(desc(sosEvents.createdAt))
      .limit(1);

    if (activeExisting) {
      return { success: true, data: { id: activeExisting.id, alreadyActive: true } };
    }

    // If no GPS in body, fall back to user's last known location
    if (latitude == null || longitude == null) {
      const [lastLoc] = await db
        .select({ latitude: locations.latitude, longitude: locations.longitude })
        .from(locations)
        .where(eq(locations.userId, sub))
        .orderBy(desc(locations.timestamp))
        .limit(1);
      if (lastLoc) {
        latitude = parseFloat(lastLoc.latitude);
        longitude = parseFloat(lastLoc.longitude);
      }
    }

    // Get reporter's name for broadcast + FCM
    const [reporter] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);

    const [sos] = await db
      .insert(sosEvents)
      .values({
        departmentId,
        reportedBy: sub,
        status: 'active',
        latitude: latitude != null ? String(latitude) : null,
        longitude: longitude != null ? String(longitude) : null,
      })
      .returning({ id: sosEvents.id });

    const firstName = reporter?.firstName ?? '';
    const lastName = reporter?.lastName ?? '';

    broadcast(departmentId, {
      event: 'sos:triggered',
      sosId: sos.id,
      userId: sub,
      firstName,
      lastName,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      timestamp: new Date().toISOString(),
    });

    // FCM to all dispatchers in department
    const dispatchers = await db
      .select({ fcmToken: users.fcmToken })
      .from(users)
      .where(and(eq(users.departmentId, departmentId)));

    const tokens = dispatchers
      .map((d) => d.fcmToken)
      .filter((t): t is string => !!t);

    if (tokens.length) {
      sendFcm(tokens, {
        type: 'sos',
        sosId: sos.id,
        senderName: `${firstName} ${lastName}`.trim(),
      });
    }

    return { success: true, data: { id: sos.id } };
  });

  // POST /api/sos/:id/cancel — field user cancels their own active SOS
  app.post<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const { sub, departmentId } = request.user as {
      sub: string;
      departmentId: string;
    };

    const [existing] = await db
      .select({
        id: sosEvents.id,
        departmentId: sosEvents.departmentId,
        reportedBy: sosEvents.reportedBy,
        status: sosEvents.status,
      })
      .from(sosEvents)
      .where(eq(sosEvents.id, request.params.id))
      .limit(1);

    if (!existing) {
      return reply.code(404).send({ success: false, error: 'SOS event not found' });
    }

    if (existing.departmentId !== departmentId || existing.reportedBy !== sub) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }

    if (existing.status !== 'active') {
      return { success: true };
    }

    await db
      .update(sosEvents)
      .set({
        status: 'cancelled',
        acknowledgedAt: new Date(),
      })
      .where(eq(sosEvents.id, request.params.id));

    broadcast(departmentId, {
      event: 'sos:cancelled',
      sosId: request.params.id,
      cancelledBy: sub,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  });

  // GET /api/sos — list SOS events (department-scoped) with filters + pagination
  app.get<{
    Querystring: {
      all?: string;
      page?: string;
      limit?: string;
      search?: string;
      from?: string;
      to?: string;
      acknowledgedBy?: string;
      // Dispatch "today" view: when from/to are a single day, also keep any
      // still-open (active/acknowledged) SOS regardless of date (midnight safety).
      includeOpen?: string;
    };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const { all, page: pageStr, limit: limitStr, search, from, to, acknowledgedBy } = request.query;
    const includeOpen = request.query.includeOpen === 'true';

    const showAll = all === 'true';
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '50', 10) || 50));
    const offset = (page - 1) * limit;

    const ackUser = alias(users, 'ack_user');
    const resolveUser = alias(users, 'resolve_user');

    const conditions: any[] = [eq(sosEvents.departmentId, departmentId)];

    if (!showAll) {
      conditions.push(eq(sosEvents.status, 'active'));
    }
    if (from || to) {
      const dateRange = and(
        from ? gte(sosEvents.createdAt, new Date(from)) : undefined,
        to ? lte(sosEvents.createdAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
      );
      // Midnight safety: a live SOS never drops off the dispatch "today" view.
      conditions.push(
        includeOpen ? or(dateRange, inArray(sosEvents.status, ['active', 'acknowledged'])) : dateRange,
      );
    }
    if (acknowledgedBy) {
      conditions.push(eq(sosEvents.acknowledgedBy, acknowledgedBy));
    }

    // Base query builder
    const baseQuery = db
      .select({
        id: sosEvents.id,
        status: sosEvents.status,
        latitude: sosEvents.latitude,
        longitude: sosEvents.longitude,
        acknowledgedAt: sosEvents.acknowledgedAt,
        resolution: sosEvents.resolution,
        resolutionNote: sosEvents.resolutionNote,
        resolvedAt: sosEvents.resolvedAt,
        createdAt: sosEvents.createdAt,
        reportedById: sosEvents.reportedBy,
        firstName: users.firstName,
        lastName: users.lastName,
        ackFirstName: ackUser.firstName,
        ackLastName: ackUser.lastName,
        resolveFirstName: resolveUser.firstName,
        resolveLastName: resolveUser.lastName,
      })
      .from(sosEvents)
      .innerJoin(users, eq(sosEvents.reportedBy, users.id))
      .leftJoin(ackUser, eq(sosEvents.acknowledgedBy, ackUser.id))
      .leftJoin(resolveUser, eq(sosEvents.resolvedBy, resolveUser.id));

    // Apply search filter on reporter name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[];
    let total: number;

    if (search) {
      const searchCond = or(
        ilike(users.firstName, `%${search}%`),
        ilike(users.lastName, `%${search}%`),
        ilike(sql`concat(${users.firstName}, ' ', ${users.lastName})`, `%${search}%`),
      );
      rows = await baseQuery
        .where(and(...conditions, searchCond))
        .orderBy(desc(sosEvents.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ value }] = await db
        .select({ value: count() })
        .from(sosEvents)
        .innerJoin(users, eq(sosEvents.reportedBy, users.id))
        .where(and(...conditions, searchCond));
      total = value;
    } else {
      rows = await baseQuery
        .where(and(...conditions))
        .orderBy(desc(sosEvents.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ value }] = await db
        .select({ value: count() })
        .from(sosEvents)
        .where(and(...conditions));
      total = value;
    }

    return {
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // POST /api/sos/:id/acknowledge — acknowledge (dispatcher+)
  app.post<{ Params: { id: string } }>('/:id/acknowledge', async (request, reply) => {
    const { sub, departmentId, roleLevel } = request.user as {
      sub: string;
      departmentId: string;
      roleLevel: number;
    };

    if (roleLevel < DISPATCHER_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const [existing] = await db
      .select({ id: sosEvents.id, departmentId: sosEvents.departmentId })
      .from(sosEvents)
      .where(eq(sosEvents.id, request.params.id))
      .limit(1);

    if (!existing) {
      return reply.code(404).send({ success: false, error: 'SOS event not found' });
    }

    if (existing.departmentId !== departmentId) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }

    await db
      .update(sosEvents)
      .set({
        status: 'acknowledged',
        acknowledgedBy: sub,
        acknowledgedAt: new Date(),
      })
      .where(eq(sosEvents.id, request.params.id));

    broadcast(departmentId, {
      event: 'sos:acknowledged',
      sosId: request.params.id,
      acknowledgedBy: sub,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  });

  // POST /api/sos/:id/resolve — resolve/close with a disposition (dispatcher+)
  app.post<{ Params: { id: string }; Body: { disposition?: string; note?: string } }>(
    '/:id/resolve',
    async (request, reply) => {
      const { sub, departmentId, roleLevel } = request.user as {
        sub: string;
        departmentId: string;
        roleLevel: number;
      };
      if (roleLevel < DISPATCHER_LEVEL) {
        return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
      }

      const disposition = request.body?.disposition;
      const note = request.body?.note?.trim() || null;
      if (!disposition || !SOS_DISPOSITIONS.some((d) => d.value === disposition)) {
        return reply.code(400).send({ success: false, error: 'A valid disposition is required' });
      }
      if (disposition === 'other' && !note) {
        return reply.code(400).send({ success: false, error: 'A note is required for "Other"' });
      }

      const [existing] = await db
        .select({ id: sosEvents.id, departmentId: sosEvents.departmentId })
        .from(sosEvents)
        .where(eq(sosEvents.id, request.params.id))
        .limit(1);
      if (!existing) return reply.code(404).send({ success: false, error: 'SOS event not found' });
      if (existing.departmentId !== departmentId) return reply.code(403).send({ success: false, error: 'Forbidden' });

      await db
        .update(sosEvents)
        .set({ status: 'resolved', resolution: disposition, resolutionNote: note, resolvedBy: sub, resolvedAt: new Date() })
        .where(eq(sosEvents.id, request.params.id));

      broadcast(departmentId, {
        event: 'sos:resolved',
        sosId: request.params.id,
        resolvedBy: sub,
        disposition,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    },
  );

  // DELETE /api/sos/:id — hard delete (admin only)
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as {
      departmentId: string;
      roleLevel: number;
    };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const [existing] = await db
      .select({ id: sosEvents.id, departmentId: sosEvents.departmentId })
      .from(sosEvents)
      .where(eq(sosEvents.id, request.params.id))
      .limit(1);

    if (!existing) {
      return reply.code(404).send({ success: false, error: 'SOS event not found' });
    }

    if (existing.departmentId !== departmentId) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }

    await db.delete(sosEvents).where(eq(sosEvents.id, request.params.id));

    return { success: true };
  });
}
