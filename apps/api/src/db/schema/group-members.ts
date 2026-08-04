import { pgTable, uuid, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { groups } from './groups.js';
import { users } from './users.js';

export const groupMembers = pgTable('group_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').references(() => groups.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  isAdmin: boolean('is_admin').default(false).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('uq_group_members').on(table.groupId, table.userId),
]);
