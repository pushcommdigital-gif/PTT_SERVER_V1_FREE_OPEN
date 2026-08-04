import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { users } from './users.js';

export const actionLogs = pgTable('action_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  targetType: varchar('target_type', { length: 30 }),
  targetId: uuid('target_id'),
  action: varchar('action', { length: 100 }).notNull(),
  details: jsonb('details').default({}).$type<Record<string, unknown>>().notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_action_logs_dept_timestamp').on(table.departmentId, table.timestamp),
  index('idx_action_logs_user_timestamp').on(table.userId, table.timestamp),
  index('idx_action_logs_target').on(table.targetType, table.targetId, table.timestamp),
]);
