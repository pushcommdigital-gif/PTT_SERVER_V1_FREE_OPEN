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
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import bcrypt from 'bcrypt';
import { departments } from './schema/departments.js';
import { users } from './schema/users.js';
import { roles } from './schema/roles.js';
import { groupTypes } from './schema/group-types.js';
import { groups } from './schema/groups.js';
import { groupMembers } from './schema/group-members.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const client = postgres(DATABASE_URL);
const db = drizzle(client);

async function seed() {
  console.log('Seeding database...');

  // Create default department
  const [dept] = await db
    .insert(departments)
    .values({
      name: 'Default Department',
      code: 'DEFAULT',
      timezone: 'Europe/Rome',
    })
    .onConflictDoNothing()
    .returning();

  const departmentId = dept?.id;
  if (!departmentId) {
    console.log('Department already exists, looking up...');
    const existing = await db.select().from(departments).limit(1);
    if (!existing.length) {
      throw new Error('Failed to create or find department');
    }
    console.log(`Using existing department: ${existing[0].name}`);
    await seedRoles(existing[0].id);
    await seedGroupTypes(existing[0].id);
    const seededUsers = await seedUsers(existing[0].id);
    await seedGroups(existing[0].id, seededUsers);
    await client.end();
    return;
  }

  console.log(`Created department: ${dept.name} (${departmentId})`);
  await seedRoles(departmentId);
  await seedGroupTypes(departmentId);
  const seededUsers = await seedUsers(departmentId);
  await seedGroups(departmentId, seededUsers);

  await client.end();
  console.log('Seed complete!');
}

async function seedRoles(departmentId: string) {
  const defaultRoles = [
    { departmentId, name: 'not_assigned', displayName: 'Not Assigned', hierarchyLevel: 0, color: '#6b7280', isSystem: true },
    { departmentId, name: 'super_admin', displayName: 'Super Admin', hierarchyLevel: 100, color: '#e74c3c', isSystem: true },
    { departmentId, name: 'admin', displayName: 'Administrator', hierarchyLevel: 80, color: '#e67e22', isSystem: true },
    { departmentId, name: 'dispatcher', displayName: 'Dispatcher', hierarchyLevel: 40, color: '#3498db', isSystem: false },
    { departmentId, name: 'driver', displayName: 'Driver', hierarchyLevel: 10, color: '#27ae60', isSystem: false },
  ];

  for (const role of defaultRoles) {
    await db.insert(roles).values(role).onConflictDoNothing();
    console.log(`  Created role: ${role.displayName} (level ${role.hierarchyLevel})`);
  }
}

async function seedGroupTypes(departmentId: string) {
  const defaults = [
    { departmentId, name: 'group', displayName: 'Group', color: '#6b7280', isSystem: true },
    { departmentId, name: 'station', displayName: 'Station', color: '#e67e22', isSystem: true },
    { departmentId, name: 'division', displayName: 'Division', color: '#3498db', isSystem: true },
  ];

  for (const gt of defaults) {
    await db.insert(groupTypes).values(gt).onConflictDoNothing();
    console.log(`  Created group type: ${gt.displayName}`);
  }
}

async function seedUsers(departmentId: string) {
  const passwordHash = await bcrypt.hash('admin123', 12);

  const seedUsers = [
    {
      departmentId,
      email: 'admin@pushcomm.local',
      username: 'admin',
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      role: 'super_admin',
    },
    {
      departmentId,
      email: 'dispatcher@pushcomm.local',
      username: 'dispatcher',
      passwordHash,
      firstName: 'Test',
      lastName: 'Dispatcher',
      role: 'dispatcher',
    },
    {
      departmentId,
      email: 'driver1@pushcomm.local',
      username: 'driver1',
      passwordHash,
      firstName: 'Driver',
      lastName: 'One',
      role: 'driver',
    },
  ];

  for (const user of seedUsers) {
    await db.insert(users).values(user).onConflictDoNothing();
    console.log(`  Created user: ${user.username} (${user.role})`);
  }

  const existingUsers = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
    })
    .from(users)
    .where(eq(users.departmentId, departmentId));

  return existingUsers;
}

async function seedGroups(
  departmentId: string,
  existingUsers: Array<{ id: string; username: string; role: string }>,
) {
  const seedGroups = [
    {
      name: 'Operations',
      type: 'group',
      description: 'Primary dispatch and field operations group',
      members: ['dispatcher', 'driver1'],
      adminMembers: ['dispatcher'],
    },
    {
      name: 'Management',
      type: 'group',
      description: 'Administrative and command users',
      members: ['admin'],
      adminMembers: ['admin'],
    },
  ];

  for (const seedGroup of seedGroups) {
    await db
      .insert(groups)
      .values({
        departmentId,
        name: seedGroup.name,
        type: seedGroup.type,
        description: seedGroup.description,
      })
      .onConflictDoNothing();

    const [group] = await db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(and(eq(groups.departmentId, departmentId), eq(groups.name, seedGroup.name), eq(groups.isDeleted, false)))
      .limit(1);

    if (!group) continue;

    console.log(`  Ensured group: ${group.name}`);

    for (const username of seedGroup.members) {
      const user = existingUsers.find((u) => u.username === username);
      if (!user) continue;

      await db
        .insert(groupMembers)
        .values({
          groupId: group.id,
          userId: user.id,
          isAdmin: seedGroup.adminMembers.includes(username),
        })
        .onConflictDoNothing();

      console.log(`    Ensured member: ${username} -> ${group.name}`);
    }
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
