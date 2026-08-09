/*
 * PushComm Community Edition
 * Copyright (C) 2026 Corbani Mauro
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { pgTable, uuid, varchar, integer, boolean, text, timestamp, index } from 'drizzle-orm/pg-core';
import { departments } from './departments.js';
import { voiceChannels } from './voice-channels.js';
import { calls } from './calls.js';
import { users } from './users.js';
import { pttSessions } from './ptt-sessions.js';
import { devices } from './devices.js';

export const voiceRecordings = pgTable('voice_recordings', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').references(() => departments.id).notNull(),
  channelId: uuid('channel_id').references(() => voiceChannels.id),
  callId: uuid('call_id').references(() => calls.id),
  source: varchar('source', { length: 30 }).default('live_ptt').notNull(),
  direction: varchar('direction', { length: 30 }).default('mixed').notNull(),
  status: varchar('status', { length: 20 }).default('processing').notNull(),
  speakerUserId: uuid('speaker_user_id').references(() => users.id),
  speakerLabel: varchar('speaker_label', { length: 255 }),
  note: text('note'),
  filePath: varchar('file_path', { length: 500 }),
  fileSize: integer('file_size'),
  mimeType: varchar('mime_type', { length: 100 }).default('audio/webm'),
  durationSec: integer('duration_sec'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  egressId: varchar('egress_id', { length: 255 }),
  pttSessionId: uuid('ptt_session_id').references(() => pttSessions.id),
  livekitIdentity: varchar('livekit_identity', { length: 255 }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

  // ── v2 targeting + identity (Phase 2) ────────────────────────────────
  targetType: varchar('target_type', { length: 20 }).default('group').notNull(), // group | private_call | all_call | sos
  targetUserId: uuid('target_user_id').references(() => users.id),
  deviceId: uuid('device_id').references(() => devices.id),
  isSos: boolean('is_sos').default(false).notNull(),
  // Snapshot of the target's display name at record time (e.g. group
  // name "North Bay Operations" or "All Call"). Not a FK — historical
  // recordings should keep the name that was current when they happened,
  // even if the group is later renamed. Mirrors speaker_label pattern.
  targetLabel: text('target_label'),

  // ── v2 capture state (audio file lifecycle, independent of transcription) ──
  captureError: text('capture_error'),
  // ended_reason: normal_release | lease_timeout | participant_disconnected
  //             | egress_failed | server_reconcile | client_abandoned
  endedReason: varchar('ended_reason', { length: 40 }),

  // NOTE: transcription state (transcript_text/_status/_provider/…) and
  // keyword flagging are columns added by the private transcription add-on's
  // migration — deliberately absent from the core schema.
}, (table) => [
  index('idx_voice_recordings_department_started').on(table.departmentId, table.startedAt),
  index('idx_voice_recordings_channel_started').on(table.channelId, table.startedAt),
  index('idx_voice_recordings_call_started').on(table.callId, table.startedAt),
]);
