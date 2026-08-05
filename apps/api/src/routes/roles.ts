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
import { eq, and, asc, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { roles } from '../db/schema/roles.js';
import { users } from '../db/schema/users.js';
import { ADMIN_LEVEL } from '@pushcomm/shared';

export async function roleRoutes(app: FastifyInstance) {
  const PROTECTED_ROLE_NAMES = new Set(['super_admin', 'admin', 'not_assigned']);

  async function ensureNotAssignedRole(departmentId: string) {
    let [fallback] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.departmentId, departmentId), eq(roles.name, 'not_assigned'), eq(roles.isDeleted, false)))
      .limit(1);

    if (!fallback) {
      [fallback] = await db
        .insert(roles)
        .values({
          departmentId,
          name: 'not_assigned',
          displayName: 'Not Assigned',
          description: 'Default role for users without a specific assignment',
          hierarchyLevel: 0,
          color: '#6b7280',
          isSystem: true,
        })
        .returning({ id: roles.id });
    }

    return fallback;
  }

  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/roles — List roles for department
  app.get('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    await ensureNotAssignedRole(departmentId);

    const result = await db
      .select({
        id: roles.id,
        departmentId: roles.departmentId,
        name: roles.name,
        displayName: roles.displayName,
        description: roles.description,
        hierarchyLevel: roles.hierarchyLevel,
        color: roles.color,
        isSystem: roles.isSystem,
        createdAt: roles.createdAt,
      })
      .from(roles)
      .where(and(eq(roles.departmentId, departmentId), eq(roles.isDeleted, false)))
      .orderBy(desc(roles.hierarchyLevel), asc(roles.displayName));

    const roleUsers = await db
      .select({
        role: users.role,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(and(eq(users.departmentId, departmentId), eq(users.isDeleted, false)));

    const membersByRole = new Map<string, string[]>();
    for (const u of roleUsers) {
      const fullName = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Unnamed User';
      const arr = membersByRole.get(u.role) ?? [];
      arr.push(fullName);
      membersByRole.set(u.role, arr);
    }

    const enriched = result.map((r) => {
      const names = (membersByRole.get(r.name) ?? []).sort((a, b) => a.localeCompare(b));
      return { ...r, userCount: names.length, users: names };
    });

    return { success: true, data: enriched };
  });

  // POST /api/roles — Create role (admin+ only)
  app.post<{
    Body: {
      name: string;
      displayName: string;
      description?: string;
      hierarchyLevel: number;
      color?: string;
    };
  }>('/', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { name, displayName, description, hierarchyLevel, color } = request.body;

    if (!name || !displayName || hierarchyLevel === undefined) {
      return reply.code(400).send({ success: false, error: 'name, displayName, and hierarchyLevel are required' });
    }

    if (hierarchyLevel < 0 || hierarchyLevel > 99) {
      return reply.code(400).send({ success: false, error: 'hierarchyLevel must be between 0 and 99' });
    }

    const [created] = await db
      .insert(roles)
      .values({
        departmentId,
        name: name.toLowerCase().replace(/\s+/g, '_'),
        displayName,
        description,
        hierarchyLevel,
        color: color || '#6b7280',
      })
      .returning();

    return reply.code(201).send({ success: true, data: created });
  });

  // PATCH /api/roles/:id — Update role (admin+ only)
  app.patch<{
    Params: { id: string };
    Body: {
      displayName?: string;
      description?: string;
      hierarchyLevel?: number;
      color?: string;
    };
  }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;
    const { displayName, description, hierarchyLevel, color } = request.body;

    // Can't set hierarchy level to 100 (reserved for super_admin)
    if (hierarchyLevel !== undefined && (hierarchyLevel < 0 || hierarchyLevel > 99)) {
      return reply.code(400).send({ success: false, error: 'hierarchyLevel must be between 0 and 99' });
    }

    const updates: Record<string, any> = {};
    if (displayName !== undefined) updates.displayName = displayName;
    if (description !== undefined) updates.description = description;
    if (hierarchyLevel !== undefined) updates.hierarchyLevel = hierarchyLevel;
    if (color !== undefined) updates.color = color;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ success: false, error: 'No fields to update' });
    }

    const [updated] = await db
      .update(roles)
      .set(updates)
      .where(and(eq(roles.id, id), eq(roles.departmentId, departmentId), eq(roles.isDeleted, false)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Role not found' });
    }

    return { success: true, data: updated };
  });

  // DELETE /api/roles/:id — Soft delete (admin+ only, not system roles)
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;

    // Check if it's a system role
    const [existing] = await db
      .select({ name: roles.name, isSystem: roles.isSystem })
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.departmentId, departmentId), eq(roles.isDeleted, false)))
      .limit(1);

    if (!existing) {
      return reply.code(404).send({ success: false, error: 'Role not found' });
    }

    if (PROTECTED_ROLE_NAMES.has(existing.name)) {
      return reply.code(400).send({ success: false, error: 'Cannot delete protected roles' });
    }

    // Ensure fallback "Not Assigned" role exists for this department.
    await ensureNotAssignedRole(departmentId);

    // Reassign all users with this role to "Not Assigned" before deleting.
    await db
      .update(users)
      .set({ role: 'not_assigned', updatedAt: new Date() })
      .where(and(eq(users.departmentId, departmentId), eq(users.role, existing.name), eq(users.isDeleted, false)));

    await db
      .update(roles)
      .set({ isDeleted: true })
      .where(and(eq(roles.id, id), eq(roles.departmentId, departmentId)));

    return { success: true, message: 'Role deleted' };
  });
}
