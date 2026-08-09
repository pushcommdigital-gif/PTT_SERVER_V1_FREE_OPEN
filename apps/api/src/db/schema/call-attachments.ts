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
import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { calls } from './calls.js';
import { users } from './users.js';

export const callAttachments = pgTable('call_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  callId: uuid('call_id').references(() => calls.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  filename: varchar('filename', { length: 255 }).notNull(),
  filePath: varchar('file_path', { length: 500 }).notNull(),
  fileSize: integer('file_size'),
  mimeType: varchar('mime_type', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
