import { pgTable, uuid, varchar, text, boolean, timestamp, integer } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { users } from './users.js';
import { groups } from './groups.js';

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  senderId: uuid('sender_id').references(() => users.id).notNull(),
  type: varchar('type', { length: 20 }).default('direct').notNull(),
  targetUserId: uuid('target_user_id').references(() => users.id),
  targetGroupId: uuid('target_group_id').references(() => groups.id),
  subject: varchar('subject', { length: 255 }),
  body: text('body').notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  filePath: varchar('file_path', { length: 500 }),
  fileSize: integer('file_size'),
  mimeType: varchar('mime_type', { length: 100 }),
});
