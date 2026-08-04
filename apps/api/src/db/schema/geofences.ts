import { pgTable, uuid, varchar, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';

export const geofences = pgTable('geofences', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  name: varchar('name', { length: 255 }).notNull(),
  // GeoJSON convention: array of [lon, lat] pairs forming a closed polygon ring
  coordinates: jsonb('coordinates').notNull().$type<[number, number][]>(),
  active: boolean('active').notNull().default(true),
  // NULL = all users monitored; populated array = only those users trigger alerts
  assignedUserIds: uuid('assigned_user_ids').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
