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
import { pgTable, uuid, varchar, text, decimal, integer, timestamp, jsonb, serial } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { users } from './users.js';

export const calls = pgTable('calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  number: serial('number'),
  name: varchar('name', { length: 255 }).notNull(),
  nature: text('nature'),
  priority: varchar('priority', { length: 20 }).default('medium').notNull(),
  type: varchar('type', { length: 100 }),
  state: varchar('state', { length: 20 }).default('active').notNull(),
  address: text('address'),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  w3w: varchar('w3w', { length: 100 }),
  source: varchar('source', { length: 50 }),
  reportedBy: uuid('reported_by').references(() => users.id),
  closedBy: uuid('closed_by').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  dispatchCount: integer('dispatch_count').default(0).notNull(),
  lastDispatchedAt: timestamp('last_dispatched_at', { withTimezone: true }),
  formData: jsonb('form_data').default({}).$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
