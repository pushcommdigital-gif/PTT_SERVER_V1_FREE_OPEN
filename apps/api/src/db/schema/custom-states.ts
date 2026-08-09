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
import { pgTable, uuid, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';

export const customStates = pgTable('custom_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  type: varchar('type', { length: 30 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  buttonText: varchar('button_text', { length: 50 }).notNull(),
  buttonColor: varchar('button_color', { length: 7 }).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
