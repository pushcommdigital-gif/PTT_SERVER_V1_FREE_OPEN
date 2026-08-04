import { pgTable, uuid, varchar, integer, decimal, boolean, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';

export const pointsOfInterest = pgTable('points_of_interest', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  name: varchar('name', { length: 255 }).notNull(),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  radiusMeters: integer('radius_meters').notNull().default(100),
  active: boolean('active').notNull().default(true),
  // NULL = all users monitored; populated array = only those users trigger alerts
  assignedUserIds: uuid('assigned_user_ids').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
