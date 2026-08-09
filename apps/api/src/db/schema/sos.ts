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
import { pgTable, uuid, varchar, text, decimal, timestamp, index } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { users } from './users.js';

export const sosEvents = pgTable('sos_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  reportedBy: uuid('reported_by').references(() => users.id).notNull(),
  // active | acknowledged | resolved | cancelled
  status: varchar('status', { length: 20 }).notNull().default('active'),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  acknowledgedBy: uuid('acknowledged_by').references(() => users.id),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  // Resolution (dispatcher closes the SOS with a disposition).
  resolution: varchar('resolution', { length: 30 }),
  resolutionNote: text('resolution_note'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_sos_dept_status').on(table.departmentId, table.status),
]);
