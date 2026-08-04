import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { groups } from './groups.js';

export const units = pgTable('units', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  stationGroupId: uuid('station_group_id').references(() => groups.id),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }),
  plateNumber: varchar('plate_number', { length: 50 }),
  vin: varchar('vin', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
