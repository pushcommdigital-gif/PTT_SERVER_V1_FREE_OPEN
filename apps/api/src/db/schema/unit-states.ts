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
import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { units } from './units.js';
import { users } from './users.js';
import { customStates } from './custom-states.js';

export const unitStates = pgTable('unit_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: uuid('unit_id').references(() => units.id).notNull(),
  state: varchar('state', { length: 50 }).notNull(),
  customStateId: uuid('custom_state_id').references(() => customStates.id),
  note: text('note'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
}, (table) => [
  index('idx_unit_states_unit_timestamp').on(table.unitId, table.timestamp),
]);
