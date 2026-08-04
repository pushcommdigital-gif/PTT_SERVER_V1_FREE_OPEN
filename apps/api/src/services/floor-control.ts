/**
 * Server-side floor authority for PTT rooms (Phase 3A of the audio recording v2 plan).
 *
 * Responsibilities:
 *   - Track who currently holds the floor in each room (in-memory).
 *   - Idempotency: dedupe retries by (departmentId, userId, roomName, requestId).
 *   - Lease: auto-release the floor if the holder doesn't release within
 *     PUSHCOMM_FLOOR_MAX_HOLD_SECONDS (default 120s).
 *   - Trigger LiveKit egress on grant. Stop egress on release.
 *   - Create the voice_recordings row with the v2 metadata
 *     (target_type, device_id, is_sos, ended_reason, capture_error).
 *   - Broadcast floor_granted / floor_released to the room via LiveKit
 *     RoomService data so other clients can update their UI (e.g. disable
 *     their PTT button while someone else is talking).
 *
 * Single-process, in-memory. Multi-API-instance deployments need to push
 * floor state into Redis (documented in the v2 plan as a future constraint).
 */

import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import { eq, and, desc, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { voiceRecordings } from '../db/schema/voice-recordings.js';
import { pttSessions } from '../db/schema/ptt-sessions.js';
import { voiceChannels } from '../db/schema/voice-channels.js';
import { users } from '../db/schema/users.js';
import { startClipEgress, stopClipEgress } from './livekit-egress.js';
import { getTrackSidWithFallback } from './livekit-track-cache.js';

const livekitHost = config.livekit.url
  .replace(/^wss:\/\//, 'https://')
  .replace(/^ws:\/\//, 'http://');
const roomSvc = new RoomServiceClient(livekitHost, config.livekit.apiKey, config.livekit.apiSecret);

const MAX_HOLD_SECONDS = (() => {
  const v = parseInt(process.env.PUSHCOMM_FLOOR_MAX_HOLD_SECONDS ?? '120', 10);
  return Number.isFinite(v) && v > 0 ? v : 120;
})();
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 min — covers any reasonable retry window
const LEASE_CHECK_INTERVAL_MS = 10 * 1000; // 10 s
// A gap longer than this between transmissions in a room starts a NEW CDR
// session/call, so sporadic activity on a fixed-name room (all-call/monitoring)
// isn't grouped into one endless "call".
const SESSION_IDLE_GAP_MS = 30 * 60 * 1000; // 30 min

// LiveKit's egress pipeline needs ~1–1.5s after startTrackEgress returns
// before it actually starts writing the .ogg. If StopEgress is called inside
// that window, LiveKit returns EGRESS_ABORTED "Stop called before pipeline
// could start" and the file is 0 bytes. Holding the stop until this minimum
// has elapsed since grant guarantees the captured clip has at least the
// tail end of the user's transmission rather than nothing. Witnessed in
// prod on rapid PTT taps; egress aborts after ~500ms presses.
const MIN_EGRESS_HOLD_MS = 1500;

// ── Types ────────────────────────────────────────────────────────────────

export type CaptureState = 'started' | 'skipped' | 'failed';
export type EndedReason =
  | 'normal_release'
  | 'lease_timeout'
  | 'participant_disconnected'
  | 'egress_failed'
  | 'server_reconcile'
  | 'client_abandoned';

export interface FloorRequestInput {
  departmentId: string;
  userId: string;
  userName: string; // for speakerLabel
  roomName: string;
  identity: string; // LiveKit participant identity (must be the requester)
  requestId: string;
  channelId?: string | null;
  targetType?: 'group' | 'private_call' | 'all_call' | 'sos';
  targetUserId?: string | null;
  targetLabel?: string | null; // human-readable target name for display
  deviceId?: string | null;
  isSos?: boolean;
}

export interface FloorGrantResult {
  floor: 'granted' | 'denied';
  capture: CaptureState;
  clipId?: string;
  egressId?: string;
  captureError?: string;
  reason?: string; // for 'denied'
}

interface FloorHolder {
  departmentId: string;
  userId: string;
  userName: string;
  identity: string;
  requestId: string;
  roomName: string;
  recordingId: string | null;
  egressId: string | null;
  pttSessionId: string | null;
  grantedAt: Date;
  leaseExpiresAt: Date;
  targetType: string;
}

// ── State ────────────────────────────────────────────────────────────────

const floorHolders = new Map<string, FloorHolder>(); // roomName → holder

/**
 * Per-room mutex. Without this, two simultaneous /voice/floor/request calls
 * for the same room both pass the "no holder" check, both start egress, and
 * floorHolders.set() is last-write-wins. The losing holder's egress is then
 * orphaned: its release call never matches a holder, so the row sits in
 * 'recording' status until the reconciler catches it. Witnessed in prod
 * 2026-05-21 when two F400s were online with the same account; both
 * requests arrived 26 µs apart and both got grants.
 *
 * Holds a promise chain per room. New work appends to the chain; the chain
 * resolves when the in-flight section finishes. Cleared opportunistically
 * to keep the map from growing.
 */
const roomLocks = new Map<string, Promise<unknown>>();
async function withRoomLock<T>(roomName: string, fn: () => Promise<T>): Promise<T> {
  const previous = roomLocks.get(roomName) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  // Chain after the previous holder of the lock. Use .then with a function
  // that runs fn() AFTER previous resolves, regardless of whether previous
  // resolved or rejected — one client's failure shouldn't poison the lane.
  const work = previous.then(fn, fn);
  roomLocks.set(roomName, work.finally(() => {
    release();
    // If we're still the head of the chain, drop the entry so the map
    // doesn't grow without bound for one-shot rooms.
    if (roomLocks.get(roomName) === work) roomLocks.delete(roomName);
  }));
  void next; // satisfy the unused-binding lint; the chain is held via roomLocks
  return work;
}

// Idempotency: scoped key → cached response (last-write-wins within TTL).
// Separate caches for grant vs. release — otherwise a release that reuses
// the grant's requestId would short-circuit on the cached grant result and
// terminateHolder would never run (witnessed 2026-05-21: recordings stuck
// in 'recording' until lease timeout).
interface IdemEntry {
  result: FloorGrantResult;
  storedAt: number;
}
interface IdemReleaseEntry {
  result: { released: boolean; reason?: string };
  storedAt: number;
}
const idempotency = new Map<string, IdemEntry>();
const releaseIdempotency = new Map<string, IdemReleaseEntry>();
let idemSweeperTimer: NodeJS.Timeout | null = null;
let leaseCheckerTimer: NodeJS.Timeout | null = null;

function idemKey(input: { departmentId: string; userId: string; roomName: string; requestId: string }): string {
  return `${input.departmentId}:${input.userId}:${input.roomName}:${input.requestId}`;
}

function sweepExpiredIdempotency(): void {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [key, entry] of idempotency.entries()) {
    if (entry.storedAt < cutoff) idempotency.delete(key);
  }
  for (const [key, entry] of releaseIdempotency.entries()) {
    if (entry.storedAt < cutoff) releaseIdempotency.delete(key);
  }
}

// ── Floor request / release ─────────────────────────────────────────────

export async function requestFloor(input: FloorRequestInput): Promise<FloorGrantResult> {
  return withRoomLock(input.roomName, () => requestFloorLocked(input));
}

async function requestFloorLocked(input: FloorRequestInput): Promise<FloorGrantResult> {
  const key = idemKey(input);
  const cached = idempotency.get(key);
  if (cached && cached.storedAt > Date.now() - IDEMPOTENCY_TTL_MS) {
    return cached.result;
  }

  // Check current holder
  const current = floorHolders.get(input.roomName);
  if (current && current.userId !== input.userId) {
    const result: FloorGrantResult = {
      floor: 'denied',
      capture: 'skipped',
      reason: `floor held by ${current.userName} since ${current.grantedAt.toISOString()}`,
    };
    idempotency.set(key, { result, storedAt: Date.now() });
    return result;
  }
  if (current && current.userId === input.userId) {
    // Same user re-requesting — return the existing grant info (idempotent at the user level)
    const result: FloorGrantResult = {
      floor: 'granted',
      capture: current.egressId ? 'started' : 'skipped',
      clipId: current.recordingId ?? undefined,
      egressId: current.egressId ?? undefined,
    };
    idempotency.set(key, { result, storedAt: Date.now() });
    return result;
  }

  // Resolve audio track SID (cache-first, RoomService fallback)
  const trackResolution = await getTrackSidWithFallback(input.roomName, input.identity);
  const trackSid = trackResolution?.sid ?? null;

  // Find or create a ptt_session for the room (so the recording links to one)
  const pttSessionId = await ensurePttSession(input);

  // Create the voice_recordings row in 'recording' state
  const speakerLabel = input.userName || input.identity;
  const targetType = input.targetType ?? 'group';
  const filePath = `/recordings/${input.roomName}/${input.identity}-${Date.now()}.ogg`;

  const [created] = await db
    .insert(voiceRecordings)
    .values({
      departmentId: input.departmentId,
      channelId: input.channelId ?? null,
      pttSessionId,
      speakerUserId: input.userId,
      speakerLabel,
      livekitIdentity: input.identity,
      targetType,
      targetUserId: input.targetUserId ?? null,
      targetLabel: input.targetLabel ?? null,
      deviceId: input.deviceId ?? null,
      isSos: input.isSos ?? false,
      filePath,
      mimeType: 'audio/ogg',
      status: 'recording',
      source: 'live_ptt',
      createdBy: input.userId,
    })
    .returning({ id: voiceRecordings.id });

  // Try to start egress
  let egressId: string | null = null;
  let captureError: string | undefined;
  if (trackSid) {
    try {
      egressId = await startClipEgress(input.roomName, trackSid, filePath);
    } catch (err: any) {
      captureError = `startClipEgress failed: ${err?.message ?? String(err)}`;
    }
  } else {
    captureError = `no audio track found for identity '${input.identity}' in room '${input.roomName}' (cache miss + RoomService fallback timeout)`;
  }

  const captureState: CaptureState = egressId ? 'started' : (trackSid ? 'failed' : 'skipped');

  if (egressId) {
    await db
      .update(voiceRecordings)
      .set({ egressId, updatedAt: new Date() })
      .where(eq(voiceRecordings.id, created.id));
  } else {
    // Capture didn't start — flip the row to failed immediately so it shows
    // up in the timeline as a failed PTT instead of a phantom "recording" row.
    await db
      .update(voiceRecordings)
      .set({
        status: 'failed',
        endedAt: new Date(),
        endedReason: 'egress_failed',
        captureError,
        updatedAt: new Date(),
      })
      .where(eq(voiceRecordings.id, created.id));
  }

  // Record the holder
  const now = new Date();
  const holder: FloorHolder = {
    departmentId: input.departmentId,
    userId: input.userId,
    userName: input.userName,
    identity: input.identity,
    requestId: input.requestId,
    roomName: input.roomName,
    recordingId: created.id,
    egressId,
    pttSessionId,
    grantedAt: now,
    leaseExpiresAt: new Date(now.getTime() + MAX_HOLD_SECONDS * 1000),
    targetType,
  };
  floorHolders.set(input.roomName, holder);

  // Broadcast floor:granted via LiveKit data so other clients update their UI.
  // Format intentionally matches what the existing client-side floor messages
  // used (legacy code in dispatch/Android listens for `type: 'floor:granted'`
  // with `userId` + `userName`). Server is now the single broadcaster — clients
  // stop sending their own floor messages once they cut over to this endpoint.
  await broadcastFloorMessage(input.roomName, {
    type: 'floor:granted',
    userId: input.userId,
    userName: input.userName,
  }).catch(() => { /* non-fatal */ });

  const result: FloorGrantResult = {
    floor: 'granted',
    capture: captureState,
    clipId: created.id,
    egressId: egressId ?? undefined,
    captureError,
  };
  idempotency.set(key, { result, storedAt: Date.now() });
  return result;
}

export async function releaseFloor(input: {
  departmentId: string;
  userId: string;
  roomName: string;
  requestId: string;
}): Promise<{ released: boolean; reason?: string }> {
  return withRoomLock(input.roomName, () => releaseFloorLocked(input));
}

async function releaseFloorLocked(input: {
  departmentId: string;
  userId: string;
  roomName: string;
  requestId: string;
}): Promise<{ released: boolean; reason?: string }> {
  const key = idemKey(input);
  const cached = releaseIdempotency.get(key);
  // Releases are idempotent on the release-side cache only. Do NOT consult
  // the grant cache here — clients commonly reuse the same requestId for
  // grant + release in a PTT cycle, and reading the grant cache would
  // short-circuit the release without terminating the holder (would leak
  // the egress until the lease timeout, ~2 min later).
  if (cached) {
    return cached.result;
  }

  const holder = floorHolders.get(input.roomName);
  if (!holder) {
    const result = { released: true, reason: 'no-current-holder' };
    releaseIdempotency.set(key, { result, storedAt: Date.now() });
    return result;
  }
  if (holder.userId !== input.userId) {
    const result = { released: false, reason: `holder is ${holder.userName}, not requester` };
    releaseIdempotency.set(key, { result, storedAt: Date.now() });
    return result;
  }

  await terminateHolder(holder, 'normal_release');
  const result = { released: true };
  releaseIdempotency.set(key, { result, storedAt: Date.now() });
  return result;
}

/**
 * Force-release the floor for a specific room. Used by lease-timeout
 * checker and participant-disconnected webhook.
 */
export async function forceReleaseFloor(roomName: string, reason: EndedReason): Promise<boolean> {
  const holder = floorHolders.get(roomName);
  if (!holder) return false;
  await terminateHolder(holder, reason);
  return true;
}

/**
 * Force-release ALL rooms held by a participant identity. Called from
 * participant_disconnected webhook because we may not know which room
 * the disconnect was for at the call site (LiveKit gives us roomName +
 * identity in the webhook payload, so we can be precise).
 */
export async function forceReleaseByIdentity(roomName: string, identity: string, reason: EndedReason): Promise<boolean> {
  const holder = floorHolders.get(roomName);
  if (!holder || holder.identity !== identity) return false;
  await terminateHolder(holder, reason);
  return true;
}

async function terminateHolder(holder: FloorHolder, reason: EndedReason): Promise<void> {
  // For abnormal termination paths (lease timeout, disconnect, egress failure)
  // we should NOT delay — the floor must release immediately. Only normal user
  // releases need the minimum-hold guard to keep brief PTT taps from
  // aborting the egress pipeline.
  if (reason === 'normal_release' && holder.egressId) {
    const elapsedMs = Date.now() - holder.grantedAt.getTime();
    const waitMs = MIN_EGRESS_HOLD_MS - elapsedMs;
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  const now = new Date();

  if (holder.egressId) {
    await stopClipEgress(holder.egressId).catch(() => { /* egress already gone */ });
  }

  if (holder.recordingId) {
    // For normal release we leave status='recording' alone — the egress_ended
    // webhook will flip it to 'ready' with the file metadata. For abnormal
    // termination (lease timeout, disconnect, egress failure), we mark it
    // failed immediately so the dashboard reflects reality even if the
    // webhook is delayed/lost. The reconciler will catch any leftover.
    if (reason === 'normal_release') {
      await db
        .update(voiceRecordings)
        .set({ endedReason: reason, updatedAt: now })
        .where(eq(voiceRecordings.id, holder.recordingId))
        .catch(() => { /* row gone? log via reconciler */ });
    } else {
      await db
        .update(voiceRecordings)
        .set({
          status: 'failed',
          endedAt: now,
          endedReason: reason,
          captureError: `floor terminated: ${reason}`,
          updatedAt: now,
        })
        .where(eq(voiceRecordings.id, holder.recordingId))
        .catch(() => { /* row gone? log via reconciler */ });
    }
  }

  floorHolders.delete(holder.roomName);

  await broadcastFloorMessage(holder.roomName, {
    type: 'floor:released',
    reason,
  }).catch(() => { /* non-fatal */ });
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function ensurePttSession(input: FloorRequestInput): Promise<string | null> {
  // Reuse the room's most recent session ONLY if it is still active AND had
  // activity within the idle gap — a burst of transmissions is one "call".
  // Rooms have fixed names (e.g. all-call is broadcast-{dept}), so without the
  // status + recency gate a transmission days later would reattach to an old
  // (already-closed) session, producing absurd CDR durations (a 8-day "call").
  const channelId = input.channelId ?? null;
  const cutoff = new Date(Date.now() - SESSION_IDLE_GAP_MS);
  const [existing] = await db
    .select({
      id: pttSessions.id,
      channelId: pttSessions.channelId,
      startedAt: pttSessions.startedAt,
      // Raw SQL MAX() comes back as a STRING (not a Date) — normalize with toMs below.
      lastClip: sql<string | null>`MAX(${voiceRecordings.startedAt})`,
    })
    .from(pttSessions)
    .leftJoin(voiceRecordings, eq(voiceRecordings.pttSessionId, pttSessions.id))
    .where(and(eq(pttSessions.roomName, input.roomName), eq(pttSessions.status, 'active')))
    .groupBy(pttSessions.id)
    .orderBy(desc(pttSessions.startedAt))
    .limit(1);

  // Raw MAX() comes back a string; pttSessions.startedAt is a Date — normalize to ms.
  const toMs = (v: string | Date): number => (typeof v === 'string' ? Date.parse(v) : v.getTime());
  const lastActivityMs = existing ? toMs(existing.lastClip ?? existing.startedAt) : 0;

  if (existing && lastActivityMs >= cutoff.getTime()) {
    // Self-heal: a session created before the channel was resolved (e.g. by the
    // room_started webhook racing the first floor request) may have a null
    // channel_id. Backfill it now that we've resolved the talkgroup.
    if (!existing.channelId && channelId) {
      await db
        .update(pttSessions)
        .set({ channelId })
        .where(eq(pttSessions.id, existing.id));
    }
    return existing.id;
  }

  // A stale-but-still-active session (missed room_finished / idle past the gap):
  // close it so it isn't reused and its CDR reflects only its own activity.
  if (existing) {
    await db
      .update(pttSessions)
      .set({ status: 'incomplete', endedAt: new Date(lastActivityMs), durationSec: null })
      .where(eq(pttSessions.id, existing.id));
  }

  const isPrivate = input.targetType === 'private_call';
  const [created] = await db
    .insert(pttSessions)
    .values({
      departmentId: input.departmentId,
      roomName: input.roomName,
      channelId,
      isPrivate,
    })
    .returning({ id: pttSessions.id });
  return created.id;
}

async function broadcastFloorMessage(roomName: string, payload: object): Promise<void> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  await roomSvc.sendData(roomName, data, DataPacket_Kind.RELIABLE);
}

// ── Background loops ────────────────────────────────────────────────────

export function startFloorBackgroundLoops(logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }): void {
  if (idemSweeperTimer || leaseCheckerTimer) return;
  idemSweeperTimer = setInterval(sweepExpiredIdempotency, IDEMPOTENCY_TTL_MS);
  leaseCheckerTimer = setInterval(() => {
    const now = Date.now();
    for (const [room, holder] of floorHolders.entries()) {
      if (holder.leaseExpiresAt.getTime() <= now) {
        terminateHolder(holder, 'lease_timeout')
          .then(() => logger.warn(`floor lease timeout in room ${room} (held by ${holder.userName})`))
          .catch((err) => logger.error(`lease timeout cleanup failed for ${room}: ${err?.message ?? err}`));
      }
    }
  }, LEASE_CHECK_INTERVAL_MS);
  logger.info(`floor-control: background loops started (lease check ${LEASE_CHECK_INTERVAL_MS / 1000}s, max hold ${MAX_HOLD_SECONDS}s, idem TTL ${IDEMPOTENCY_TTL_MS / 1000}s)`);
}

export function stopFloorBackgroundLoops(): void {
  if (idemSweeperTimer) { clearInterval(idemSweeperTimer); idemSweeperTimer = null; }
  if (leaseCheckerTimer) { clearInterval(leaseCheckerTimer); leaseCheckerTimer = null; }
}

/** Test helper. Not used in production. */
export function _stateForTests() {
  return { floorHolders, idempotency };
}
