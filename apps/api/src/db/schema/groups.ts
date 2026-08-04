import { pgTable, uuid, varchar, text, decimal, boolean, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  parentGroupId: uuid('parent_group_id'),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).default('group').notNull(),
  description: text('description'),
  address: text('address'),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
