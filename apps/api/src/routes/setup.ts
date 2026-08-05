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
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { appConfig } from '../db/schema/app-config.js';
import { departments } from '../db/schema/departments.js';
import { roles } from '../db/schema/roles.js';
import { groupTypes } from '../db/schema/group-types.js';
import { users } from '../db/schema/users.js';

// First-boot setup wizard backend. PUBLIC (pre-auth) but SELF-DISABLING: once setup
// is complete, the mutating endpoint refuses. "Complete" = the flag is set OR a
// department already exists — so existing installs (the live VPS) are auto-adopted
// and never see the wizard.

const SETUP_FLAG = 'setup_complete';

const DEFAULT_ROLES = [
  { name: 'not_assigned', displayName: 'Not Assigned', hierarchyLevel: 0, color: '#6b7280', isSystem: true },
  { name: 'super_admin', displayName: 'Super Admin', hierarchyLevel: 100, color: '#e74c3c', isSystem: true },
  { name: 'admin', displayName: 'Administrator', hierarchyLevel: 80, color: '#e67e22', isSystem: true },
  { name: 'dispatcher', displayName: 'Dispatcher', hierarchyLevel: 40, color: '#3498db', isSystem: false },
  { name: 'driver', displayName: 'Driver', hierarchyLevel: 10, color: '#27ae60', isSystem: false },
];
const DEFAULT_GROUP_TYPES = [
  { name: 'group', displayName: 'Group', color: '#6b7280', isSystem: true },
  { name: 'station', displayName: 'Station', color: '#e67e22', isSystem: true },
  { name: 'division', displayName: 'Division', color: '#3498db', isSystem: true },
];

async function isSetupComplete(): Promise<boolean> {
  const [flag] = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, SETUP_FLAG))
    .limit(1);
  if (flag?.value === 'true') return true;
  // Adopt a pre-existing install: a department already present = already set up.
  const [dept] = await db.select({ id: departments.id }).from(departments).limit(1);
  return !!dept;
}

export async function setupRoutes(app: FastifyInstance) {
  // GET /api/setup/state — public, read-only. The dashboard uses this to decide
  // whether to show the wizard.
  app.get('/state', async (_request, reply) => {
    return reply.send({ success: true, data: { setupComplete: await isSetupComplete() } });
  });

  // POST /api/setup/initialize — create the org + first super-admin.
  // Public, but refuses once setup is complete.
  app.post<{
    Body: {
      organizationName?: string;
      timezone?: string;
      admin?: { firstName?: string; lastName?: string; username?: string; email?: string; password?: string };
    };
  }>('/initialize', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request, reply) => {
    if (await isSetupComplete()) {
      return reply.code(409).send({ success: false, error: 'Setup has already been completed' });
    }

    const body = request.body ?? {};
    const orgName = body.organizationName?.trim();
    const a = body.admin ?? {};
    const firstName = a.firstName?.trim();
    const lastName = a.lastName?.trim();
    const username = a.username?.trim();
    const email = a.email?.trim() || null;
    const password = a.password;

    if (!orgName) return reply.code(400).send({ success: false, error: 'Organization name is required' });
    if (!firstName || !lastName) return reply.code(400).send({ success: false, error: 'Admin first and last name are required' });
    if (!username) return reply.code(400).send({ success: false, error: 'Admin username is required' });
    if (!password || password.length < 6) return reply.code(400).send({ success: false, error: 'Password must be at least 6 characters' });

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      await db.transaction(async (tx) => {
        const [dept] = await tx
          .insert(departments)
          .values({ name: orgName, code: 'MAIN', timezone: body.timezone?.trim() || 'UTC' })
          .returning({ id: departments.id });
        const departmentId = dept.id;

        await tx.insert(roles).values(DEFAULT_ROLES.map((r) => ({ ...r, departmentId }))).onConflictDoNothing();
        await tx.insert(groupTypes).values(DEFAULT_GROUP_TYPES.map((g) => ({ ...g, departmentId }))).onConflictDoNothing();
        await tx.insert(users).values({ departmentId, email, username, passwordHash, firstName, lastName, role: 'super_admin' });
      });
    } catch (e: any) {
      if (e?.code === '23505') {
        return reply.code(409).send({ success: false, error: 'That username or email is already taken' });
      }
      app.log.error(e, '[setup] initialize failed');
      return reply.code(500).send({ success: false, error: 'Setup failed' });
    }

    await db
      .insert(appConfig)
      .values({ key: SETUP_FLAG, value: 'true', updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.key, set: { value: 'true', updatedAt: new Date() } });

    app.log.info(`[setup] initialized org "${orgName}" with super-admin "${username}"`);
    // Frontend logs in with the entered credentials via the normal /auth/login flow.
    return reply.send({ success: true });
  });
}
