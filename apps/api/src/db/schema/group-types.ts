import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';

export const groupTypes = pgTable('group_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  name: varchar('name', { length: 50 }).notNull(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  description: varchar('description', { length: 255 }),
  color: varchar('color', { length: 7 }).notNull().default('#6b7280'),
  isSystem: boolean('is_system').default(false).notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
