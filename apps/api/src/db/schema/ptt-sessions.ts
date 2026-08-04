import { pgTable, uuid, varchar, integer, boolean, timestamp, decimal, index } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { voiceChannels } from './voice-channels.js';

export const pttSessions = pgTable('ptt_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  roomName: varchar('room_name', { length: 255 }).notNull(),
  channelId: uuid('channel_id').references(() => voiceChannels.id),
  isPrivate: boolean('is_private').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationSec: integer('duration_sec'),
  maxParticipantCount: integer('max_participant_count').default(0),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  locationLat: decimal('location_lat', { precision: 10, scale: 8 }),
  locationLon: decimal('location_lon', { precision: 11, scale: 8 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_ptt_sessions_dept').on(table.departmentId, table.startedAt),
  index('idx_ptt_sessions_channel').on(table.channelId, table.startedAt),
]);
