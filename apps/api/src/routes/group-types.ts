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
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { groupTypes } from '../db/schema/group-types.js';
import { ADMIN_LEVEL } from '@pushcomm/shared';

export async function groupTypeRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/group-types — List group types for department
  app.get('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };

    const result = await db
      .select()
      .from(groupTypes)
      .where(and(eq(groupTypes.departmentId, departmentId), eq(groupTypes.isDeleted, false)))
      .orderBy(asc(groupTypes.name));

    return { success: true, data: result };
  });

  // POST /api/group-types — Create group type
  app.post<{
    Body: { name: string; displayName: string; description?: string; color?: string };
  }>('/', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { name, displayName, description, color } = request.body;

    if (!name || !displayName) {
      return reply.code(400).send({ success: false, error: 'Name and display name are required' });
    }

    // Check for duplicate name
    const [existing] = await db
      .select({ id: groupTypes.id })
      .from(groupTypes)
      .where(and(eq(groupTypes.departmentId, departmentId), eq(groupTypes.name, name.toLowerCase()), eq(groupTypes.isDeleted, false)))
      .limit(1);

    if (existing) {
      return reply.code(409).send({ success: false, error: 'A group type with this name already exists' });
    }

    const [created] = await db
      .insert(groupTypes)
      .values({
        departmentId,
        name: name.toLowerCase().replace(/\s+/g, '_'),
        displayName,
        description,
        color: color || '#6b7280',
      })
      .returning();

    return reply.code(201).send({ success: true, data: created });
  });

  // PATCH /api/group-types/:id — Update group type
  app.patch<{
    Params: { id: string };
    Body: { displayName?: string; description?: string; color?: string };
  }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;
    const { displayName, description, color } = request.body;

    const updates: Record<string, unknown> = {};
    if (displayName !== undefined) updates.displayName = displayName;
    if (description !== undefined) updates.description = description;
    if (color !== undefined) updates.color = color;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ success: false, error: 'No fields to update' });
    }

    const [updated] = await db
      .update(groupTypes)
      .set(updates)
      .where(and(eq(groupTypes.id, id), eq(groupTypes.departmentId, departmentId), eq(groupTypes.isDeleted, false)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Group type not found' });
    }

    return { success: true, data: updated };
  });

  // DELETE /api/group-types/:id — Soft delete
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;

    // Check if system type
    const [gt] = await db
      .select({ isSystem: groupTypes.isSystem })
      .from(groupTypes)
      .where(and(eq(groupTypes.id, id), eq(groupTypes.departmentId, departmentId), eq(groupTypes.isDeleted, false)))
      .limit(1);

    if (!gt) {
      return reply.code(404).send({ success: false, error: 'Group type not found' });
    }

    if (gt.isSystem) {
      return reply.code(400).send({ success: false, error: 'Cannot delete system group types' });
    }

    await db
      .update(groupTypes)
      .set({ isDeleted: true })
      .where(eq(groupTypes.id, id));

    return { success: true, message: 'Group type deleted' };
  });
}
