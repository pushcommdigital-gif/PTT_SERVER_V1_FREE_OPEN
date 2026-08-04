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

