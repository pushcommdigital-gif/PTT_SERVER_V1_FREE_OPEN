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
import { pgTable, uuid, decimal, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { units } from './units.js';

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  unitId: uuid('unit_id').references(() => units.id),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  altitude: decimal('altitude', { precision: 8, scale: 2 }),
  accuracy: decimal('accuracy', { precision: 8, scale: 2 }),
  speed: decimal('speed', { precision: 8, scale: 2 }),
  heading: decimal('heading', { precision: 5, scale: 2 }),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_locations_user_timestamp').on(table.userId, table.timestamp),
  index('idx_locations_unit_timestamp').on(table.unitId, table.timestamp),
]);
