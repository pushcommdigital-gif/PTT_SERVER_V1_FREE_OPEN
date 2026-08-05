/*
 * PushComm Community Edition
 * Copyright (C) 2026 PushComm Digital
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema/index.js';
import { config } from '../config.js';

let _app: App | undefined;
let _messaging: Messaging | undefined;
let _initialised = false;

function getFirebaseMessaging(): Messaging | null {
  if (_initialised) return _messaging ?? null;
  _initialised = true;

  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) return null;

  try {
    const serviceAccount = JSON.parse(readFileSync(resolve(keyPath), 'utf-8'));
    // Avoid re-initialising if another part of the app already did so
    _app = getApps().length === 0
      ? initializeApp({ credential: cert(serviceAccount) })
      : getApps()[0];
    _messaging = getMessaging(_app);
  } catch (e) {
    console.error('[FCM] Failed to initialise Firebase Admin:', e);
  }

  return _messaging ?? null;
}

/**
 * Send a data-only FCM message to one or more device tokens.
 * Fire-and-forget — errors are logged but never thrown so callers are unaffected.
 *
 * @param tokens  FCM registration tokens (max 500 per call)
 * @param data    Key-value string pairs delivered as message.data on Android
 */
export async function sendFcm(
  tokens: string[],
  data: Record<string, string>,
): Promise<void> {
  if (tokens.length === 0) return;

  const messaging = getFirebaseMessaging();
  if (!messaging) return; // FCM not configured — silently skip

  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      data,
      android: { priority: 'high' },
    });

    if (response.failureCount > 0) {
      console.warn(
        `[FCM] ${response.failureCount}/${tokens.length} sends failed:`,
        response.responses
          .filter((r) => !r.success)
          .map((r) => r.error?.message),
      );

      // Collect tokens that Firebase says are no longer valid and wipe them
      // from the users table so they don't keep failing on future sends.
      const staleTokens: string[] = [];
      response.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error?.code ?? '';
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token' ||
            r.error?.message?.includes('Requested entity was not found')
          ) {
            staleTokens.push(tokens[i]);
          }
        }
      });

      if (staleTokens.length > 0) {
        console.log(`[FCM] Clearing ${staleTokens.length} stale token(s) from DB`);
        await db
          .update(users)
          .set({ fcmToken: null })
          .where(inArray(users.fcmToken, staleTokens));
      }
    }
  } catch (e) {
    console.error('[FCM] sendEachForMulticast error:', e);
  }
}
