import { pgTable, uuid, varchar, decimal, timestamp, index } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { users } from './users.js';

export const zoneAlerts = pgTable('zone_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  /** 'geofence' | 'poi' */
  zoneType: varchar('zone_type', { length: 10 }).notNull(),
  zoneId: uuid('zone_id').notNull(),
  zoneName: varchar('zone_name', { length: 255 }).notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  /** 'enter' | 'exit' */
  alertType: varchar('alert_type', { length: 10 }).notNull(),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_zone_alerts_dept_date').on(table.departmentId, table.triggeredAt),
  index('idx_zone_alerts_user').on(table.userId),
]);
