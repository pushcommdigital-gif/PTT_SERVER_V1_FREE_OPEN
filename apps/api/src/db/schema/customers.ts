import { pgTable, uuid, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { users } from './users.js';

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).default('business').notNull(),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 50 }),
  zipCode: varchar('zip_code', { length: 20 }),
  primaryContactName: varchar('primary_contact_name', { length: 255 }),
  primaryContactPhone: varchar('primary_contact_phone', { length: 50 }),
  primaryContactEmail: varchar('primary_contact_email', { length: 255 }),
  deliveryNotes: text('delivery_notes'),
  tags: text('tags'),
  isActive: boolean('is_active').default(true).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_customers_department_name').on(table.departmentId, table.name),
]);
