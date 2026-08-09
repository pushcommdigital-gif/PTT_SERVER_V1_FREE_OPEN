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
import { pgTable, uuid, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { customers } from './customers.js';
import { customerLocations } from './customer-locations.js';
import { users } from './users.js';
import { units } from './units.js';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  number: integer('number').generatedAlwaysAsIdentity(),
  customerId: uuid('customer_id').references(() => customers.id).notNull(),
  customerLocationId: uuid('customer_location_id').references(() => customerLocations.id),
  jobType: varchar('job_type', { length: 20 }).default('delivery').notNull(), // pickup | delivery
  state: varchar('state', { length: 20 }).default('new').notNull(), // new | assigned | enroute | arrived | completed | failed
  priority: varchar('priority', { length: 20 }).default('medium').notNull(), // low | medium | high | emergency
  notes: text('notes'),
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  assignedUnitId: uuid('assigned_unit_id').references(() => units.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_jobs_department_state').on(table.departmentId, table.state),
  index('idx_jobs_customer').on(table.customerId),
  index('idx_jobs_assigned_unit').on(table.assignedUnitId),
  index('idx_jobs_assigned_user').on(table.assignedUserId),
]);
