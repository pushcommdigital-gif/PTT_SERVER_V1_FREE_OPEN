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
import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { calls } from './calls.js';
import { users } from './users.js';

export const callDispatches = pgTable('call_dispatches', {
  id: uuid('id').primaryKey().defaultRandom(),
  callId: uuid('call_id').references(() => calls.id).notNull(),
  dispatchType: varchar('dispatch_type', { length: 20 }).notNull(),
  targetId: uuid('target_id').notNull(),
  dispatchedBy: uuid('dispatched_by').references(() => users.id),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).defaultNow().notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  onSceneAt: timestamp('on_scene_at', { withTimezone: true }),
  clearedAt: timestamp('cleared_at', { withTimezone: true }),
});
