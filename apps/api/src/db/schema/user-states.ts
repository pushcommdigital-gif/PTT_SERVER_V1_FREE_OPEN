import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { customStates } from './custom-states.js';

export const userStates = pgTable('user_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  state: varchar('state', { length: 50 }).notNull(),
  customStateId: uuid('custom_state_id').references(() => customStates.id),
  note: text('note'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
}, (table) => [
  index('idx_user_states_user_timestamp').on(table.userId, table.timestamp),
]);
