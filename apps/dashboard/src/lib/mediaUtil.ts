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
/** Authenticated stream URL for a media asset (token in query for <img>/<video>/<audio>). */
export function mediaStreamUrl(id: string): string {
  const token = localStorage.getItem('accessToken');
  return `/api/media/${id}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** "dispatcher_requested_photo" -> "Dispatcher Requested Photo" */
export function recordingLabel(rt: string): string {
  return rt.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
