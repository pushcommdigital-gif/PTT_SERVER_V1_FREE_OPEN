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
 * Get the audio track SID for a participant. Tries the cache first, falls
 * back to a single bounded RoomService.listParticipants call on miss
 * (handles webhook race / lost packet).
 */
export async function getTrackSidWithFallback(
  roomName: string,
  identity: string,
  fallbackTimeoutMs = 200,
): Promise<{ sid: string; source: 'cache' | 'fallback' } | null> {
  const cached = cache.get(roomName)?.get(identity);
  if (cached) return { sid: cached, source: 'cache' };

  // Bounded fallback. We use Promise.race to enforce the timeout because
  // RoomServiceClient itself has no per-call timeout option.
  const result = await Promise.race<{ sid: string } | null>([
    (async () => {
      try {
        const participant = await roomSvc.getParticipant(roomName, identity);
        const audio = participant.tracks.find((t) => t.type === AUDIO_TRACK_TYPE);
        if (audio?.sid) {
          rememberTrack(roomName, identity, audio.sid);
          return { sid: audio.sid };
        }
      } catch {
        // participant not found / network error
      }
      return null;
    })(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), fallbackTimeoutMs)),
  ]);

  return result ? { sid: result.sid, source: 'fallback' } : null;
}

/** Test helper: clears all entries. Not used in production. */
export function _clearForTests(): void {
  cache.clear();
}
