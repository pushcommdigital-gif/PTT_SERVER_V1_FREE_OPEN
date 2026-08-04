import { pgTable, uuid, unique, index } from 'drizzle-orm/pg-core';
import { voiceChannels } from './voice-channels.js';
import { groups } from './groups.js';

export const voiceChannelGroups = pgTable('voice_channel_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').references(() => voiceChannels.id).notNull(),
  groupId: uuid('group_id').references(() => groups.id).notNull(),
}, (table) => [
  unique('uq_voice_channel_groups').on(table.channelId, table.groupId),
  index('idx_vcg_channel').on(table.channelId),
  index('idx_vcg_group').on(table.groupId),
]);

