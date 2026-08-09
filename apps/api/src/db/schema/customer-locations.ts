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
import { pgTable, uuid, varchar, text, decimal, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { customers } from './customers.js';

export const customerLocations = pgTable('customer_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  customerId: uuid('customer_id').references(() => customers.id).notNull(),
  label: varchar('label', { length: 120 }),
  address: text('address').notNull(),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  hoursOfOperation: text('hours_of_operation'),
  accessNotes: text('access_notes'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_customer_locations_customer').on(table.customerId),
  index('idx_customer_locations_department').on(table.departmentId),
]);
