import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { eq, and, desc, asc, sql, count, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pttSessions } from '../db/schema/ptt-sessions.js';
import { voiceRecordings } from '../db/schema/voice-recordings.js';
import { voiceChannels } from '../db/schema/voice-channels.js';
import { groups } from '../db/schema/groups.js';
import { users } from '../db/schema/users.js';
import { locations } from '../db/schema/locations.js';
import { getAudioTrackId, startClipEgress, stopClipEgress } from '../services/livekit-egress.js';
import { config } from '../config.js';

// Recordings base path: /recordings in Docker prod; override via RECORDINGS_PATH in dev host
const RECORDINGS_PATH = process.env.RECORDINGS_PATH || '/recordings';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Talkgroup display label. Group PTT rooms are named `group-{groupId}` (from the
// `groups` table) and all-call rooms `broadcast-{deptId}` — these never link to a
// `voice_channels` row, so channel_id is null. Fall back to the group name, then
// synthesize a label for all-call/private so the CDR never shows "Unknown".
const channelLabelSql = sql<string | null>`COALESCE(
  ${voiceChannels.name},
  ${groups.name},
  CASE
    WHEN ${pttSessions.isPrivate} THEN 'Private Call'
    WHEN ${pttSessions.roomName} LIKE 'broadcast-%' THEN 'All-Call'
    ELSE NULL
  END
)`;

export async function pttSessionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // POST /clips/start — client triggers when a speaker acquires the floor
  app.post<{
    Body: { roomName: string; speakerIdentity: string; channelId?: string };
  }>('/clips/start', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { roomName, speakerIdentity, channelId } = request.body;

    if (!roomName || !speakerIdentity) {
      return reply.code(400).send({ success: false, error: 'roomName and speakerIdentity are required' });
    }

    if (!config.livekit.apiKey || !config.livekit.apiSecret) {
      return reply.code(503).send({ success: false, error: 'LiveKit not configured' });
    }

    // Ensure a ptt_session exists for this room (create if missing — handles dev mode)
    let [session] = await db
      .select({ id: pttSessions.id })
      .from(pttSessions)
      .where(
        and(
          eq(pttSessions.roomName, roomName),
          eq(pttSessions.status, 'active'),
          eq(pttSessions.departmentId, departmentId),
        ),
      )
      .limit(1);

    // Validate channelId against voice_channels (group PTT sends a group UUID, not a channel UUID)
    const [channelByRoom] = await db
      .select({ id: voiceChannels.id })
      .from(voiceChannels)
      .where(eq(voiceChannels.livekitRoom, roomName))
      .limit(1);

    let resolvedChannelId: string | null = channelByRoom?.id ?? null;
    if (!resolvedChannelId && channelId && UUID_RE.test(channelId)) {
      const [channelById] = await db
        .select({ id: voiceChannels.id })
        .from(voiceChannels)
        .where(eq(voiceChannels.id, channelId))
        .limit(1);
      resolvedChannelId = channelById?.id ?? null;
    }

    if (!session) {
      // Look up first speaker's most recent GPS fix (within last 30 min)
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
      const [gps] = await db
        .select({ latitude: locations.latitude, longitude: locations.longitude })
        .from(locations)
        .where(and(eq(locations.userId, speakerIdentity), gte(locations.timestamp, thirtyMinAgo)))
        .orderBy(desc(locations.timestamp))
        .limit(1);

      const [inserted] = await db
        .insert(pttSessions)
        .values({
          departmentId,
          roomName,
          channelId: resolvedChannelId,
          isPrivate: roomName.startsWith('private-'),
          status: 'active',
          locationLat: gps?.latitude ?? undefined,
          locationLon: gps?.longitude ?? undefined,
        })
        .returning({ id: pttSessions.id });
      session = inserted;
    }

    // Clean up zombie 'recording' entries for this speaker (e.g. from abrupt disconnects)
    const zombies = await db
      .select({ id: voiceRecordings.id, egressId: voiceRecordings.egressId })
      .from(voiceRecordings)
      .where(
        and(
          eq(voiceRecordings.livekitIdentity, speakerIdentity),
          eq(voiceRecordings.status, 'recording'),
          eq(voiceRecordings.departmentId, departmentId),
        ),
      );
    for (const z of zombies) {
      if (z.egressId) {
        try { await stopClipEgress(z.egressId); } catch { /* already stopped */ }
      }
      await db
        .update(voiceRecordings)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(voiceRecordings.id, z.id));
    }

    // Get the speaker's audio track ID from the LiveKit server
    const trackId = await getAudioTrackId(roomName, speakerIdentity);
    if (!trackId) {
      return reply.code(422).send({ success: false, error: 'Speaker audio track not found in room' });
    }

    // Look up speaker info
    const [speaker] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, speakerIdentity))
      .limit(1);

    const speakerLabel = speaker ? `${speaker.firstName} ${speaker.lastName}` : speakerIdentity;
    // Store as /recordings/... canonical path; stream handler remaps to RECORDINGS_PATH on host
    const outputPath = `/recordings/${roomName}/${speakerIdentity}-${Date.now()}.ogg`;

    let egressId: string;
    try {
      egressId = await startClipEgress(roomName, trackId, outputPath);
    } catch (err) {
      app.log.error(err, 'Failed to start clip egress');
      return reply.code(502).send({ success: false, error: 'Failed to start egress' });
    }

    const [clip] = await db
      .insert(voiceRecordings)
      .values({
        departmentId,
        channelId: resolvedChannelId,
        pttSessionId: session.id,
        source: 'live_ptt',
        direction: speakerIdentity === sub ? 'dispatch_to_field' : 'field_to_dispatch',
        status: 'recording',
        speakerUserId: speakerIdentity,
        speakerLabel,
        livekitIdentity: speakerIdentity,
        egressId,
        filePath: outputPath,
        mimeType: 'audio/ogg',
        createdBy: sub,
      })
      .returning({ id: voiceRecordings.id });

    return { success: true, data: { clipId: clip.id, egressId } };
  });

  // POST /clips/stop — client triggers when a speaker releases the floor
  app.post<{
    Body: { egressId: string; clipId: string };
  }>('/clips/stop', async (request, reply) => {
    const { egressId, clipId } = request.body;

    if (!egressId || !clipId) {
      return reply.code(400).send({ success: false, error: 'egressId and clipId are required' });
    }

    try {
      await stopClipEgress(egressId);
    } catch (err) {
      app.log.warn(err, 'stopClipEgress failed — egress may have already stopped');
    }

    await db
      .update(voiceRecordings)
      .set({ status: 'processing', endedAt: new Date(), updatedAt: new Date() })
      .where(eq(voiceRecordings.id, clipId));

    return { success: true };
  });

  // GET / — paginated PTT session list (CDR)
  app.get<{
    Querystring: { page?: string; limit?: string; channelId?: string; from?: string; to?: string };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '20', 10)));
    const offset = (page - 1) * limit;
    const { channelId, from, to } = request.query;

    const conditions = [eq(pttSessions.departmentId, departmentId)];
    if (channelId) conditions.push(eq(pttSessions.channelId, channelId));
    if (from) conditions.push(gte(pttSessions.startedAt, new Date(from)));
    if (to) conditions.push(lte(pttSessions.startedAt, new Date(to)));

    const whereClause = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(pttSessions)
      .where(whereClause);

    const rows = await db
      .select({
        id: pttSessions.id,
        roomName: pttSessions.roomName,
        channelId: pttSessions.channelId,
        channelName: channelLabelSql,
        isPrivate: pttSessions.isPrivate,
        startedAt: pttSessions.startedAt,
        endedAt: pttSessions.endedAt,
        // CDR duration = the actual talk-activity span (first clip start → last clip
        // end), not the room/session lifetime. Persistent monitoring keeps rooms open
        // for hours, so the stored duration_sec overstates the call; the clip span is
        // the meaningful number. Null when the session has no clips.
        // FAILED clips (egress never captured audio) are excluded — a failed clip's
        // ended_at can be far from the real call and would inflate the span.
        durationSec: sql<number | null>`ROUND(EXTRACT(EPOCH FROM (
          MAX(${voiceRecordings.endedAt}) FILTER (WHERE ${voiceRecordings.status} <> 'failed')
          - MIN(${voiceRecordings.startedAt}) FILTER (WHERE ${voiceRecordings.status} <> 'failed')
        )))::int`,
        maxParticipantCount: pttSessions.maxParticipantCount,
        status: pttSessions.status,
        locationLat: pttSessions.locationLat,
        locationLon: pttSessions.locationLon,
        clipCount: sql<number>`count(${voiceRecordings.id})::int`,
      })
      .from(pttSessions)
      .leftJoin(voiceChannels, eq(voiceChannels.id, pttSessions.channelId))
      .leftJoin(groups, sql`${pttSessions.roomName} = 'group-' || ${groups.id}`)
      .leftJoin(voiceRecordings, eq(voiceRecordings.pttSessionId, pttSessions.id))
      .where(whereClause)
      .groupBy(pttSessions.id, voiceChannels.name, groups.name, pttSessions.locationLat, pttSessions.locationLon)
      .orderBy(desc(pttSessions.startedAt))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // GET /:id — session detail with clips
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [session] = await db
      .select({
        id: pttSessions.id,
        roomName: pttSessions.roomName,
        channelId: pttSessions.channelId,
        channelName: channelLabelSql,
        isPrivate: pttSessions.isPrivate,
        startedAt: pttSessions.startedAt,
        endedAt: pttSessions.endedAt,
        durationSec: pttSessions.durationSec,
        maxParticipantCount: pttSessions.maxParticipantCount,
        status: pttSessions.status,
      })
      .from(pttSessions)
      .leftJoin(voiceChannels, eq(voiceChannels.id, pttSessions.channelId))
      .leftJoin(groups, sql`${pttSessions.roomName} = 'group-' || ${groups.id}`)
      .where(and(eq(pttSessions.id, id), eq(pttSessions.departmentId, departmentId)))
      .limit(1);

    if (!session) {
      return reply.code(404).send({ success: false, error: 'Session not found' });
    }

    const clips = await db
      .select({
        id: voiceRecordings.id,
        speakerUserId: voiceRecordings.speakerUserId,
        speakerLabel: voiceRecordings.speakerLabel,
        speakerFirstName: users.firstName,
        speakerLastName: users.lastName,
        startedAt: voiceRecordings.startedAt,
        endedAt: voiceRecordings.endedAt,
        durationSec: voiceRecordings.durationSec,
        fileSize: voiceRecordings.fileSize,
        status: voiceRecordings.status,
        filePath: voiceRecordings.filePath,
        // Dispatch-console speakers (dispatcher/admin) transmit from the web and have
        // no GPS — the CDR shows the label "Dispatch" for their location/address.
        isDispatch: sql<boolean>`${users.role} in ('dispatcher', 'admin', 'super_admin')`,
        locationLat: sql<string | null>`(
          SELECT latitude FROM locations
          WHERE user_id = ${voiceRecordings.speakerUserId}
            AND timestamp BETWEEN ${voiceRecordings.startedAt} - interval '10 minutes'
                               AND ${voiceRecordings.startedAt} + interval '10 minutes'
          ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - ${voiceRecordings.startedAt})))
          LIMIT 1
        )`,
        locationLon: sql<string | null>`(
          SELECT longitude FROM locations
          WHERE user_id = ${voiceRecordings.speakerUserId}
            AND timestamp BETWEEN ${voiceRecordings.startedAt} - interval '10 minutes'
                               AND ${voiceRecordings.startedAt} + interval '10 minutes'
          ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - ${voiceRecordings.startedAt})))
          LIMIT 1
        )`,
      })
      .from(voiceRecordings)
      .leftJoin(users, eq(users.id, voiceRecordings.speakerUserId))
      .where(
        and(
          eq(voiceRecordings.pttSessionId, id),
          eq(voiceRecordings.departmentId, departmentId),
        ),
      )
      .orderBy(asc(voiceRecordings.startedAt));

    return { success: true, data: { ...session, clips } };
  });

  // DELETE /api/ptt-sessions/:id — remove a CDR session and everything under it:
  // its clip rows AND their audio files on disk. Admin only. This is the proper way
  // to clear recordings; deleting clip rows alone leaves the session counting against
  // CDR totals, and deleting files by hand leaves orphan rows (the 247-min ghost).
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };
    if (roleLevel < 80) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ success: false, error: 'Invalid session id' });

    const [session] = await db
      .select({ id: pttSessions.id })
      .from(pttSessions)
      .where(and(eq(pttSessions.id, id), eq(pttSessions.departmentId, departmentId)))
      .limit(1);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });

    // Unlink the clip files first (best-effort), then drop the rows, then the session.
    const clips = await db
      .select({ filePath: voiceRecordings.filePath })
      .from(voiceRecordings)
      .where(and(eq(voiceRecordings.pttSessionId, id), eq(voiceRecordings.departmentId, departmentId)));
    for (const clip of clips) {
      if (!clip.filePath) continue;
      const fp = clip.filePath.startsWith('/recordings')
        ? path.join(RECORDINGS_PATH, clip.filePath.slice('/recordings'.length))
        : clip.filePath;
      try { fs.unlinkSync(fp); } catch { /* file may already be gone */ }
    }
    await db.delete(voiceRecordings).where(and(eq(voiceRecordings.pttSessionId, id), eq(voiceRecordings.departmentId, departmentId)));
    await db.delete(pttSessions).where(and(eq(pttSessions.id, id), eq(pttSessions.departmentId, departmentId)));

    return { success: true, data: { id, clipsDeleted: clips.length } };
  });
}
