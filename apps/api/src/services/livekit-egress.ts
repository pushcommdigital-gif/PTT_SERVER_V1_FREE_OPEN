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
import { EgressClient, RoomServiceClient } from 'livekit-server-sdk';
import { and, eq, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { voiceRecordings } from '../db/schema/voice-recordings.js';

const livekitHost = config.livekit.url
  .replace(/^wss:\/\//, 'https://')
  .replace(/^ws:\/\//, 'http://');

const egressClient = new EgressClient(livekitHost, config.livekit.apiKey, config.livekit.apiSecret);
const roomSvc = new RoomServiceClient(livekitHost, config.livekit.apiKey, config.livekit.apiSecret);

// TrackType.AUDIO = 0 in @livekit/protocol
const AUDIO_TRACK_TYPE = 0;

/**
 * Retrieve the audio track SID for a participant.
 * Retries up to 3 times (400ms apart) to handle the race between
 * setMicrophoneEnabled() on the client and the server registering the track.
 */
export async function getAudioTrackId(roomName: string, identity: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const participant = await roomSvc.getParticipant(roomName, identity);
      const audioTrack = participant.tracks.find((t) => t.type === AUDIO_TRACK_TYPE);
      if (audioTrack?.sid) return audioTrack.sid;
    } catch {
      // participant not in room yet or error
    }
    if (attempt < 2) await new Promise<void>((r) => setTimeout(r, 400));
  }
  return null;
}

/**
 * Start a TrackEgress that records a single audio track to a local file.
 * Returns the egressId needed to stop it later.
 */
export async function startClipEgress(
  roomName: string,
  trackId: string,
  outputPath: string,
): Promise<string> {
  const info = await egressClient.startTrackEgress(
    roomName,
    { filepath: outputPath } as any,
    trackId,
  );
  return info.egressId;
}

/**
 * Stop a running egress. The egress service will finalize and write the file.
 */
export async function stopClipEgress(egressId: string): Promise<void> {
  await egressClient.stopEgress(egressId);
}

const STUCK_RECORDING_TTL_MINUTES = 5;

/**
 * Find recordings stuck in `status='recording'` because the LiveKit
 * `egress_ended` webhook never arrived (network blip, container crash, etc.)
 * and mark them as failed so the dashboard reflects reality instead of
 * showing a row "recording" forever.
 *
 * Best-effort tries to actually stop the runaway egress by ID first — if
 * the egress is genuinely still running but webhook is just lost, this
 * lets the file finalize. The egress_ended webhook handler may then race
 * us and update the row to status='ready' with a proper file path; that's
 * fine — operator-facing state ends up correct either way.
 */
export async function reconcileStuckRecordings(): Promise<{ checked: number; reconciled: number }> {
  const cutoff = new Date(Date.now() - STUCK_RECORDING_TTL_MINUTES * 60_000);
  const stuck = await db
    .select({ id: voiceRecordings.id, egressId: voiceRecordings.egressId })
    .from(voiceRecordings)
    .where(and(eq(voiceRecordings.status, 'recording'), lt(voiceRecordings.startedAt, cutoff)));

  if (stuck.length === 0) return { checked: 0, reconciled: 0 };

  const now = new Date();
  let reconciled = 0;
  for (const row of stuck) {
    if (row.egressId) {
      await egressClient.stopEgress(row.egressId).catch(() => {
        // ignore — egress may already be gone
      });
    }
    await db
      .update(voiceRecordings)
      .set({
        status: 'failed',
        endedAt: now,
        updatedAt: now,
        endedReason: 'server_reconcile',
        captureError: `egress_ended webhook timeout (>${STUCK_RECORDING_TTL_MINUTES} min); reconciled at ${now.toISOString()}`,
      })
      .where(eq(voiceRecordings.id, row.id));
    reconciled += 1;
  }
  return { checked: stuck.length, reconciled };
}

let reconcileTimer: NodeJS.Timeout | null = null;

/** Start the background reconciliation loop (60s interval). Idempotent. */
export function startStuckRecordingReconciler(logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    reconcileStuckRecordings()
      .then((res) => {
        if (res.reconciled > 0) {
          logger.warn(`reconcileStuckRecordings: marked ${res.reconciled}/${res.checked} stuck recordings as failed`);
        }
      })
      .catch((err) => logger.error(`reconcileStuckRecordings failed: ${err?.message ?? err}`));
  }, 60_000);
  logger.info('reconcileStuckRecordings: background loop started (60s interval, 5min TTL)');
}

/** Stop the background loop. Used by tests + graceful shutdown. */
export function stopStuckRecordingReconciler(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
}
