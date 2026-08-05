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
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { customStates } from '../db/schema/custom-states.js';
import { userStates } from '../db/schema/user-states.js';
import { broadcast } from '../ws/broadcast.js';

const ALLOWED_PERSONNEL_STATES = new Set([
  'available',
  'busy',
  'en_route',
  'on_scene',
  'break',
  'unavailable',
  'off_duty',
  'emergency',
]);

const STATE_LABELS: Record<string, string> = {
  available: 'Available',
  busy: 'Busy',
  en_route: 'En Route',
  on_scene: 'On Scene',
  break: 'Break',
  unavailable: 'Unavailable',
  off_duty: 'Off Duty',
  emergency: 'Emergency',
};

function normalizeState(input: string): string {
  return input.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function customStateValue(state: { name: string; buttonText: string }): string {
  return normalizeState(state.name || state.buttonText);
}

export async function userStateRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/user-states/me - latest status for the authenticated user.
  app.get('/me', async (request) => {
    const { sub } = request.user as { sub: string };

    const [latest] = await db
      .select({
        id: userStates.id,
        state: userStates.state,
        note: userStates.note,
        timestamp: userStates.timestamp,
        customStateId: userStates.customStateId,
        label: customStates.buttonText,
        color: customStates.buttonColor,
      })
      .from(userStates)
      .leftJoin(customStates, eq(customStates.id, userStates.customStateId))
      .where(eq(userStates.userId, sub))
      .orderBy(desc(userStates.timestamp))
      .limit(1);

    return {
      success: true,
      data: latest
        ? {
            ...latest,
            label: latest.label ?? STATE_LABELS[latest.state] ?? latest.state,
            color: latest.color ?? null,
            timestamp: latest.timestamp.toISOString(),
          }
        : null,
    };
  });

  // GET /api/user-states/options - active personnel-status choices for this department.
  app.get('/options', async (request) => {
    const { departmentId } = request.user as { departmentId: string };

    const states = await db
      .select({
        id: customStates.id,
        name: customStates.name,
        buttonText: customStates.buttonText,
        buttonColor: customStates.buttonColor,
        displayOrder: customStates.displayOrder,
      })
      .from(customStates)
      .where(and(
        eq(customStates.departmentId, departmentId),
        eq(customStates.type, 'personnel'),
        eq(customStates.isDeleted, false),
      ))
      .orderBy(asc(customStates.displayOrder));

    const options = states.length > 0
      ? states.map((state) => ({
          id: state.id,
          state: customStateValue(state),
          label: state.buttonText,
          color: state.buttonColor,
          displayOrder: state.displayOrder,
        }))
      : Array.from(ALLOWED_PERSONNEL_STATES).map((state, index) => ({
          id: null,
          state,
          label: STATE_LABELS[state] ?? state,
          color: null,
          displayOrder: index + 1,
        }));

    return { success: true, data: options };
  });

  // POST /api/user-states/me - append a new current status row for this user.
  app.post<{
    Body: {
      state?: string;
      note?: string;
    };
  }>('/me', async (request, reply) => {
    const { departmentId, sub } = request.user as { departmentId: string; sub: string };
    const state = normalizeState(request.body.state ?? '');
    const note = request.body.note?.trim() || null;

    if (!state) {
      return reply.code(400).send({ success: false, error: 'Invalid personnel status' });
    }

    const activeCustomStates = await db
      .select({ id: customStates.id, name: customStates.name, buttonText: customStates.buttonText, buttonColor: customStates.buttonColor })
      .from(customStates)
      .where(and(
        eq(customStates.departmentId, departmentId),
        eq(customStates.type, 'personnel'),
        eq(customStates.isDeleted, false),
      ))
      .orderBy(asc(customStates.displayOrder));

    const matchingCustomState = activeCustomStates.find((customState) => customStateValue(customState) === state);

    if (!matchingCustomState && !ALLOWED_PERSONNEL_STATES.has(state)) {
      return reply.code(400).send({ success: false, error: 'Invalid personnel status' });
    }

    const expectedLabel = matchingCustomState?.buttonText ?? STATE_LABELS[state] ?? state.replace(/_/g, ' ');

    const [created] = await db
      .insert(userStates)
      .values({
        userId: sub,
        state,
        customStateId: matchingCustomState?.id ?? null,
        note,
        changedBy: sub,
      })
      .returning();

    broadcast(departmentId, {
      event: 'user:status_changed',
      userId: sub,
      state,
      changedBy: sub,
      timestamp: created.timestamp.toISOString(),
    });

    return reply.code(201).send({
      success: true,
      data: {
        id: created.id,
        state: created.state,
        label: matchingCustomState?.buttonText ?? expectedLabel,
        color: matchingCustomState?.buttonColor ?? null,
        timestamp: created.timestamp.toISOString(),
      },
    });
  });
}
