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
// Browser-side download of one or more recording clips (no server-side zip needed).
// Hits the /download endpoint, which transcodes the stored OGG/Opus to MP3 on the
// fly; fetches each as a blob and triggers a save, sequentially so the browser
// doesn't block a burst of simultaneous downloads.
export async function downloadClips(clips: { id: string; name: string }[]): Promise<void> {
  for (const c of clips) {
    const token = localStorage.getItem('accessToken');
    const url = `/api/voice-recordings/${c.id}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(c.name || c.id).replace(/[^\w.\- ]+/g, '_')}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      await new Promise((r) => setTimeout(r, 250));
    } catch {
      /* skip this one, continue the rest */
    }
  }
}
