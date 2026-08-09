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
import { pgTable, uuid, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { groups } from './groups.js';
import { users } from './users.js';

export const groupMembers = pgTable('group_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').references(() => groups.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  isAdmin: boolean('is_admin').default(false).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('uq_group_members').on(table.groupId, table.userId),
]);
