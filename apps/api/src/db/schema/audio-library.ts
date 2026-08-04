import { pgTable, uuid, varchar, integer, decimal, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { users } from './users.js';

export const audioLibrary = pgTable('audio_library', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  filename: varchar('filename', { length: 255 }).notNull(),
  filePath: varchar('file_path', { length: 500 }).notNull(),
  fileSize: integer('file_size'),
  duration: decimal('duration', { precision: 10, scale: 2 }),
  mimeType: varchar('mime_type', { length: 100 }),
  category: varchar('category', { length: 20 }).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
