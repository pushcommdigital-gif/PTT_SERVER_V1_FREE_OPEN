import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Global (install-wide, NOT department-scoped) key/value config. First use: the
// applied license token, so a license can be installed from the dashboard
// without editing .env or SSHing. Also a home for future install-wide settings.
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
