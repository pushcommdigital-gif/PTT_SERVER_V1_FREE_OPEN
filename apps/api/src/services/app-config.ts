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
// Tiny accessor for the install-wide app_config key/value store (see
// db/schema/app-config.ts). Used for global settings like the transcription
// on/off toggle. (The license token has its own store: license-store.ts.)
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { appConfig } from '../db/schema/app-config.js';

export async function getConfigValue(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } });
}

// Device session length: how long an activated device stays logged in without
// re-auth (the device REFRESH token lifetime). The 15-min access token is
// unaffected, so a disabled/deleted device is still locked out within ~15 min.
// Default 'never' — field radios stay logged in until an admin disables them.
export const DEVICE_SESSION_KEY = 'device_session_ttl';
export const DEVICE_SESSION_VALUES = ['never', '7d', '30d', '90d', '180d'] as const;
export type DeviceSessionTtl = (typeof DEVICE_SESSION_VALUES)[number];

export async function getDeviceSessionTtl(): Promise<DeviceSessionTtl> {
  const v = await getConfigValue(DEVICE_SESSION_KEY);
  return (DEVICE_SESSION_VALUES as readonly string[]).includes(v ?? '') ? (v as DeviceSessionTtl) : 'never';
}

/** JWT sign options for a device refresh token per the configured session length. */
export async function getDeviceRefreshSignOptions(): Promise<{ expiresIn?: string }> {
  const ttl = await getDeviceSessionTtl();
  return ttl === 'never' ? {} : { expiresIn: ttl };
}
