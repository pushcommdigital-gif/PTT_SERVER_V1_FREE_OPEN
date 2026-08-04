import { pgTable, uuid, varchar, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  permissionType: varchar('permission_type', { length: 50 }).notNull(),
  role: varchar('role', { length: 20 }),
  allowed: boolean('allowed').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('uq_permissions').on(table.departmentId, table.permissionType, table.role),
]);
