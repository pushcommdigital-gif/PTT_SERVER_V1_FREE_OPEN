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
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Global (install-wide, NOT department-scoped) key/value config. First use: the
// applied license token, so a license can be installed from the dashboard
// without editing .env or SSHing. Also a home for future install-wide settings.
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
