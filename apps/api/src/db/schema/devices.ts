import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { users } from './users.js';
import { groups } from './groups.js';

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  imei: varchar('imei', { length: 20 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  model: varchar('model', { length: 100 }),
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  assignedGroupId: uuid('assigned_group_id').references(() => groups.id),
  provisioningKey: varchar('provisioning_key', { length: 64 }).notNull(),
  provisioningCodeHash: varchar('provisioning_code_hash', { length: 64 }),
  provisioningCodeExpiresAt: timestamp('provisioning_code_expires_at', { withTimezone: true }),
  provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  firmwareVersion: varchar('firmware_version', { length: 50 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
