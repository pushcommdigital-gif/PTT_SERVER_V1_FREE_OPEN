/**
 * POST /api/voice/floor/request and /api/voice/floor/release.
 *
 * The strict floor handshake (see plan §Phase 3A):
 *   1. Client (PTT pressed) holds mic muted, sends POST /voice/floor/request
 *      with a client-generated UUID `requestId`.
 *   2. API authorises (JWT valid, identity matches user, optional channelId
 *      belongs to the user's department).
 *   3. API checks no other speaker holds the floor.
 *   4. API resolves the speaker's audio track SID (cache-first, RoomService
 *      fallback, then 'capture: skipped' if both fail).
 *   5. API spawns LiveKit egress on the resolved track.
 *   6. API broadcasts floor_granted via LiveKit data and returns
 *      `{ floor: 'granted', capture: 'started'|'skipped'|'failed', clipId? }`.
 *   7. Client unmutes mic ONLY on the returned ack (and plays the
 *      "you can talk now" beep).
 *
 * Note: deeper channel-membership ACL is enforced upstream when the user's
 * LiveKit JWT is issued (see /api/voice-channels/:id/activate). A user who
 * holds a valid PushComm JWT and a corresponding LiveKit room token has
 * already been authorised for the room. The checks here are defense-in-
 * depth + identity binding.
 */

import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { voiceChannels } from '../db/schema/voice-channels.js';
import { users } from '../db/schema/users.js';
import { requestFloor, releaseFloor } from '../services/floor-control.js';

interface FloorRequestBody {
  requestId: string;
  roomName: string;
  identity: string;
  channelId?: string | null;
  targetType?: 'group' | 'private_call' | 'all_call' | 'sos';
  targetUserId?: string | null;
  targetLabel?: string | null;
  deviceId?: string | null;
  isSos?: boolean;
}

interface FloorReleaseBody {
  requestId: string;
  roomName: string;
}

export async function voiceFloorRoutes(app: FastifyInstance) {
  // Standard JWT gate (matches every other authenticated route plugin).
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // ── POST /voice/floor/request ───────────────────────────────────────
  app.post<{ Body: FloorRequestBody }>('/request', async (request, reply) => {
    const { sub: userId, departmentId } = request.user as { sub: string; departmentId: string };
    const body = request.body;

    if (!body || !body.requestId || !body.roomName || !body.identity) {
      return reply.code(400).send({
        success: false,
        error: 'requestId, roomName and identity are required',
      });
    }

    // Identity binding: prevents user A from claiming user B's LiveKit
    // identity in a request.
    if (body.identity !== userId) {
      return reply.code(403).send({
        success: false,
        error: 'identity does not match authenticated user',
      });
    }

    // Resolve the voice channel so the session/recording links to a talkgroup.
    // Primary: the LiveKit room name maps directly to a voice_channel
    // (voice_channels.livekitRoom == roomName) — this is reliable for group
    // PTT, where the client's `channelId` is actually a GROUP id (a different
    // table) and would otherwise leave channel_id null. Fallback: the client
    // sent a real voice_channels.id. Private-call rooms match neither and
    // stay null (shown as "Private Call"). We never 403 — LiveKit token
    // issuance already verified room access.
    let resolvedVoiceChannelId: string | null = null;
    const [byRoom] = await db
      .select({ id: voiceChannels.id })
      .from(voiceChannels)
      .where(and(eq(voiceChannels.livekitRoom, body.roomName), eq(voiceChannels.departmentId, departmentId)))
      .limit(1);
    if (byRoom) {
      resolvedVoiceChannelId = byRoom.id;
    } else if (body.channelId) {
      const [channel] = await db
        .select({ id: voiceChannels.id, departmentId: voiceChannels.departmentId })
        .from(voiceChannels)
        .where(eq(voiceChannels.id, body.channelId))
        .limit(1);
      if (channel && channel.departmentId === departmentId) {
        resolvedVoiceChannelId = channel.id;
      }
    }

    const userName = await getUserDisplayName(userId);

    const result = await requestFloor({
      departmentId,
      userId,
      userName,
      roomName: body.roomName,
      identity: body.identity,
      requestId: body.requestId,
      // Only pass through a verified voice_channels.id — never a group id.
      // Avoids FK constraint failures in voice_recordings.channel_id.
      channelId: resolvedVoiceChannelId,
      targetType: body.targetType,
      targetUserId: body.targetUserId ?? null,
      targetLabel: body.targetLabel ?? null,
      deviceId: body.deviceId ?? null,
      isSos: body.isSos ?? false,
    });

    if (result.floor === 'denied') {
      return reply.code(409).send({ success: false, error: result.reason ?? 'Floor denied', data: result });
    }
    return reply.send({ success: true, data: result });
  });

  // ── POST /voice/floor/release ───────────────────────────────────────
  app.post<{ Body: FloorReleaseBody }>('/release', async (request, reply) => {
    const { sub: userId, departmentId } = request.user as { sub: string; departmentId: string };
    const body = request.body;

    if (!body || !body.requestId || !body.roomName) {
      return reply.code(400).send({
        success: false,
        error: 'requestId and roomName are required',
      });
    }

    const result = await releaseFloor({
      departmentId,
      userId,
      roomName: body.roomName,
      requestId: body.requestId,
    });
    return reply.send({ success: true, data: result });
  });
}

async function getUserDisplayName(userId: string): Promise<string> {
  const [row] = await db
    .select({
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return userId;
  const full = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
  return full || row.username || userId;
}
