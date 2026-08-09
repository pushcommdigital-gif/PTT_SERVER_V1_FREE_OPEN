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
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, integer, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  name: varchar('name', { length: 50 }).notNull(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  description: varchar('description', { length: 255 }),
  hierarchyLevel: integer('hierarchy_level').notNull().default(0),
  color: varchar('color', { length: 7 }).notNull().default('#6b7280'),
  isSystem: boolean('is_system').default(false).notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('uq_roles_department_name_active')
    .on(table.departmentId, table.name)
    .where(sql`${table.isDeleted} = false`),
]);
