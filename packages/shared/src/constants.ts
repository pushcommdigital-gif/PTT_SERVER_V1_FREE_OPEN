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
// Roles are now dynamic (stored in DB per department).
// These constants define permission thresholds for API route guards.
export type Role = string;

export const SUPER_ADMIN_LEVEL = 100;
export const ADMIN_LEVEL = 80;
export const DISPATCHER_LEVEL = 40;

export const USER_STATES = [
  'available',
  'responding',
  'on_scene',
  'returning',
  'off_duty',
] as const;
export type UserState = (typeof USER_STATES)[number];

export const UNIT_STATES = [
  'in_service',
  'out_of_service',
  'maintenance',
  'enroute',
  'on_scene',
] as const;
export type UnitState = (typeof UNIT_STATES)[number];

export const CALL_PRIORITIES = ['low', 'medium', 'high', 'emergency'] as const;
export type CallPriority = (typeof CALL_PRIORITIES)[number];

export const CALL_STATES = ['active', 'closed', 'cancelled', 'unfounded'] as const;
export type CallState = (typeof CALL_STATES)[number];

export const CALL_SOURCES = ['internal', 'phone', 'web', 'radio'] as const;
export type CallSource = (typeof CALL_SOURCES)[number];

export const DISPATCH_TYPES = ['user', 'group', 'unit', 'role'] as const;
export type DispatchType = (typeof DISPATCH_TYPES)[number];

// Group types are now dynamic (stored in DB per department).
export type GroupType = string;

export const MESSAGE_TYPES = ['direct', 'group', 'broadcast'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const AUDIO_CATEGORIES = ['emergency', 'alert', 'standard', 'info', 'custom'] as const;
export type AudioCategory = (typeof AUDIO_CATEGORIES)[number];

export const CUSTOM_STATE_TYPES = ['personnel', 'staffing', 'unit'] as const;
export type CustomStateType = (typeof CUSTOM_STATE_TYPES)[number];

export const AUDIO_CATEGORY_COLORS: Record<AudioCategory, string> = {
  emergency: '#e74c3c',
  alert: '#e67e22',
  standard: '#3498db',
  info: '#27ae60',
  custom: '#9b59b6',
};

// --- SOS / Lone Worker ---

// SOS lifecycle: Active → Acknowledged → Resolved (with disposition); Cancelled
// (field user) from any pre-resolved state.
export const SOS_STATUSES = ['active', 'acknowledged', 'resolved', 'cancelled'] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];

// Disposition required when a dispatcher resolves an SOS ('other' requires a note).
export const SOS_DISPOSITIONS: { value: string; label: string }[] = [
  { value: 'false_alarm', label: 'False alarm' },
  { value: 'units_dispatched', label: 'Units dispatched' },
  { value: 'resolved_on_scene', label: 'Resolved on scene' },
  { value: 'other', label: 'Other' },
];
