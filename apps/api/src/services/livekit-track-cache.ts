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
/**
 * In-memory cache of (roomName, identity) → audio track SID, kept in sync
 * with LiveKit `track_published` / `track_unpublished` /
 * `participant_disconnected` webhooks.
 *
 * Why: when the floor handshake (POST /voice/floor/request) needs to start
 * egress on a participant's audio track, calling RoomService.listParticipants
 * every time costs ~50ms (network round-trip to LiveKit) and races against
 * mid-reconnect participants. The cache makes the lookup ~0ms in the common
 * case. A bounded fallback to listParticipants handles the rare miss
 * (webhook delayed/lost).
 *
 * **Cache invalidation is critical**: stale SIDs after a reconnect are the
 * #1 way this would silently break. Both track_unpublished AND
 * participant_disconnected must clear entries.
 *
 * Single-process, in-memory. Multi-API-instance deployments will need to
 * push this into Redis (documented in the v2 plan as a future constraint).
 */

import { RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config.js';

const livekitHost = config.livekit.url
  .replace(/^wss:\/\//, 'https://')
  .replace(/^ws:\/\//, 'http://');

const roomSvc = new RoomServiceClient(livekitHost, config.livekit.apiKey, config.livekit.apiSecret);
const AUDIO_TRACK_TYPE = 0; // TrackType.AUDIO in @livekit/protocol

// roomName → identity → trackSid
const cache = new Map<string, Map<string, string>>();

export function rememberTrack(roomName: string, identity: string, trackSid: string): void {
  let inner = cache.get(roomName);
  if (!inner) {
    inner = new Map();
    cache.set(roomName, inner);
  }
  inner.set(identity, trackSid);
}

export function forgetTrack(roomName: string, identity: string): void {
  const inner = cache.get(roomName);
  if (!inner) return;
  inner.delete(identity);
  if (inner.size === 0) cache.delete(roomName);
}

/** Remove a participant's whole entry (covers participant_disconnected). */
export function forgetParticipant(roomName: string, identity: string): void {
  forgetTrack(roomName, identity);
}

/** Remove the entire room when LiveKit reports room_finished. */
export function forgetRoom(roomName: string): void {
  cache.delete(roomName);
}

/**
 * Why a track lookup came back empty. These are genuinely different problems —
 * "the speaker never joined", "the speaker joined but is publishing no audio",
 * "the SFU didn't answer in time" and "the SFU returned an error" send you to
 * four different places — so they are reported separately rather than collapsed
 * into one guess.
 */
export type TrackLookupFailure =
  | 'no-participant'
  | 'no-audio-track'
  | 'lookup-timeout'
  | 'lookup-error';

export type TrackLookup =
  | { sid: string; source: 'cache' | 'fallback' }
  | { sid: null; reason: TrackLookupFailure };

export const trackLookupFailureText: Record<TrackLookupFailure, string> = {
  'no-participant': 'the speaker is not in the room (never joined, or already left)',
  'no-audio-track': 'the speaker is in the room but is publishing no audio track',
  'lookup-timeout': 'the SFU did not answer the track lookup in time',
  'lookup-error': 'the SFU returned an error for the track lookup',
};

/**
 * Get the audio track SID for a participant. Tries the cache first, falls
 * back to a single bounded RoomService.getParticipant call on miss
 * (handles webhook race / lost packet).
 */
export async function getTrackSidWithFallback(
  roomName: string,
  identity: string,
  fallbackTimeoutMs = 200,
): Promise<TrackLookup> {
  const cached = cache.get(roomName)?.get(identity);
  if (cached) return { sid: cached, source: 'cache' };

  // Bounded fallback. We use Promise.race to enforce the timeout because
  // RoomServiceClient itself has no per-call timeout option.
  const result = await Promise.race<TrackLookup>([
    (async (): Promise<TrackLookup> => {
      try {
        const participant = await roomSvc.getParticipant(roomName, identity);
        const audio = participant.tracks.find((t) => t.type === AUDIO_TRACK_TYPE);
        if (audio?.sid) {
          rememberTrack(roomName, identity, audio.sid);
          return { sid: audio.sid, source: 'fallback' };
        }
        return { sid: null, reason: 'no-audio-track' };
      } catch (err: any) {
        // The SDK reports an absent participant as a not-found error; anything
        // else is a real failure talking to the SFU, and they should not read
        // the same in a log.
        const notFound =
          err?.code === 'not_found' ||
          err?.status === 404 ||
          /not.?found/i.test(String(err?.message ?? ''));
        return { sid: null, reason: notFound ? 'no-participant' : 'lookup-error' };
      }
    })(),
    new Promise<TrackLookup>((resolve) =>
      setTimeout(() => resolve({ sid: null, reason: 'lookup-timeout' }), fallbackTimeoutMs),
    ),
  ]);

  return result;
}

/** Test helper: clears all entries. Not used in production. */
export function _clearForTests(): void {
  cache.clear();
}
