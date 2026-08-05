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
import { pgTable, uuid, unique, index } from 'drizzle-orm/pg-core';
import { voiceChannels } from './voice-channels.js';
import { users } from './users.js';

export const voiceChannelUsers = pgTable('voice_channel_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').references(() => voiceChannels.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
}, (table) => [
  unique('uq_voice_channel_users').on(table.channelId, table.userId),
  index('idx_vcu_channel').on(table.channelId),
  index('idx_vcu_user').on(table.userId),
]);

