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
import { pgTable, uuid, varchar, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';

export const geofences = pgTable('geofences', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  name: varchar('name', { length: 255 }).notNull(),
  // GeoJSON convention: array of [lon, lat] pairs forming a closed polygon ring
  coordinates: jsonb('coordinates').notNull().$type<[number, number][]>(),
  active: boolean('active').notNull().default(true),
  // NULL = all users monitored; populated array = only those users trigger alerts
  assignedUserIds: uuid('assigned_user_ids').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
