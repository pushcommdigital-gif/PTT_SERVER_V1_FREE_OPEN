import { pgTable, uuid, varchar, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';

export const voiceChannels = pgTable('voice_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  livekitRoom: varchar('livekit_room', { length: 100 }).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
