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
import { pgTable, uuid, varchar, decimal, timestamp, index } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { users } from './users.js';

export const zoneAlerts = pgTable('zone_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  /** 'geofence' | 'poi' */
  zoneType: varchar('zone_type', { length: 10 }).notNull(),
  zoneId: uuid('zone_id').notNull(),
  zoneName: varchar('zone_name', { length: 255 }).notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  /** 'enter' | 'exit' */
  alertType: varchar('alert_type', { length: 10 }).notNull(),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_zone_alerts_dept_date').on(table.departmentId, table.triggeredAt),
  index('idx_zone_alerts_user').on(table.userId),
]);
