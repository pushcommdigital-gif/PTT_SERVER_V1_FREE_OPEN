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
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { createReadStream, existsSync, statSync, unlinkSync } from 'fs';
import { spawn } from 'node:child_process';
import path from 'path';
import { db } from '../db/index.js';
import { voiceRecordings } from '../db/schema/voice-recordings.js';
import { voiceChannels } from '../db/schema/voice-channels.js';
import { pttSessions } from '../db/schema/ptt-sessions.js';
import { groups } from '../db/schema/groups.js';
import { calls } from '../db/schema/calls.js';
import { users } from '../db/schema/users.js';
import { DISPATCHER_LEVEL } from '@pushcomm/shared';

const VOICE_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'voice');
// PTT recordings base — /recordings inside Docker prod; override via RECORDINGS_PATH env for dev host

const RECORDINGS_PATH = process.env.RECORDINGS_PATH || '/recordings';
const RECORDING_STATUSES = ['processing', 'ready', 'failed'] as const;
const RECORDING_DIRECTIONS = ['dispatch_to_field', 'field_to_dispatch', 'mixed'] as const;

export async function voiceRecordingRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    // Allow token via ?token= query param for stream endpoints (media elements can't set Authorization header)
    const query = request.query as Record<string, string>;
    if (query?.token) {
      request.headers['authorization'] = `Bearer ${query.token}`;
    }
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/voice-recordings - list live voice traffic recordings
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      search?: string;
      channelId?: string;
      callId?: string;
      status?: string;
    };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const search = request.query.search?.trim();
    const channelId = request.query.channelId?.trim();
    const callId = request.query.callId?.trim();
    const status = request.query.status?.trim();

    const conditions: any[] = [eq(voiceRecordings.departmentId, departmentId)];
    if (channelId) conditions.push(eq(voiceRecordings.channelId, channelId));
    if (callId) conditions.push(eq(voiceRecordings.callId, callId));
    if (status && RECORDING_STATUSES.includes(status as any)) conditions.push(eq(voiceRecordings.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(voiceRecordings.speakerLabel, `%${search}%`),
          ilike(voiceRecordings.note, `%${search}%`),
        )!,
      );
    }

    const whereClause = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(voiceRecordings)
      .where(whereClause);

    const channelAlias = db
      .select({ id: voiceChannels.id, name: voiceChannels.name })
      .from(voiceChannels)
      .as('recording_channel');

    const callAlias = db
      .select({ id: calls.id, number: calls.number, name: calls.name })
      .from(calls)
      .as('recording_call');

    const speakerAlias = db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username })
      .from(users)
      .as('recording_speaker');

    // Group PTT recordings link to a `group-{id}` room via their ptt_session, not
    // to a voice_channel. Resolve the talkgroup name through the session→group
    // path so the channel column never shows "Unknown".
    const sessionAlias = db
      .select({ id: pttSessions.id, roomName: pttSessions.roomName })
      .from(pttSessions)
      .as('recording_session');

    const groupAlias = db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .as('recording_group');

    const channelLabelSql = sql<string | null>`COALESCE(
      ${channelAlias.name},
      ${groupAlias.name},
      NULLIF(${voiceRecordings.targetLabel}, ''),
      CASE ${voiceRecordings.targetType}
        WHEN 'private_call' THEN 'Private Call'
        WHEN 'all_call' THEN 'All-Call'
        WHEN 'sos' THEN 'SOS'
        ELSE NULL
      END
    )`;

    const data = await db
      .select({
        id: voiceRecordings.id,
        channelId: voiceRecordings.channelId,
        callId: voiceRecordings.callId,
        source: voiceRecordings.source,
        direction: voiceRecordings.direction,
        status: voiceRecordings.status,
        speakerUserId: voiceRecordings.speakerUserId,
        speakerLabel: voiceRecordings.speakerLabel,
        note: voiceRecordings.note,
        filePath: voiceRecordings.filePath,
        fileSize: voiceRecordings.fileSize,
        mimeType: voiceRecordings.mimeType,
        durationSec: voiceRecordings.durationSec,
        startedAt: voiceRecordings.startedAt,
        endedAt: voiceRecordings.endedAt,
        createdAt: voiceRecordings.createdAt,
        updatedAt: voiceRecordings.updatedAt,
        // v2 metadata
        targetType: voiceRecordings.targetType,
        targetUserId: voiceRecordings.targetUserId,
        targetLabel: voiceRecordings.targetLabel,
        deviceId: voiceRecordings.deviceId,
        isSos: voiceRecordings.isSos,
        endedReason: voiceRecordings.endedReason,
        captureError: voiceRecordings.captureError,
        // joined display fields
        channelName: channelLabelSql,
        callNumber: callAlias.number,
        callName: callAlias.name,
        speakerFirstName: speakerAlias.firstName,
        speakerLastName: speakerAlias.lastName,
        speakerUsername: speakerAlias.username,
      })
      .from(voiceRecordings)
      .leftJoin(channelAlias, eq(voiceRecordings.channelId, channelAlias.id))
      .leftJoin(sessionAlias, eq(voiceRecordings.pttSessionId, sessionAlias.id))
      .leftJoin(groupAlias, sql`${sessionAlias.roomName} = 'group-' || ${groupAlias.id}`)
      .leftJoin(callAlias, eq(voiceRecordings.callId, callAlias.id))
      .leftJoin(speakerAlias, eq(voiceRecordings.speakerUserId, speakerAlias.id))
      .where(whereClause)
      .orderBy(desc(voiceRecordings.startedAt))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  });

  // POST /api/voice-recordings - create recording metadata (ingestion hook)
  app.post<{
    Body: {
      channelId?: string;
      callId?: string;
      source?: string;
      direction?: string;
      speakerUserId?: string;
      speakerLabel?: string;
      note?: string;
      filePath?: string;
      fileSize?: number;
      mimeType?: string;
      durationSec?: number;
      startedAt?: string;
      endedAt?: string;
      status?: string;
    };
  }>('/', async (request, reply) => {
    const { sub, departmentId, roleLevel } = request.user as { sub: string; departmentId: string; roleLevel: number };
    if (roleLevel < DISPATCHER_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const body = request.body || {};
    const direction = body.direction || 'mixed';
    const status = body.status || 'processing';
    if (!RECORDING_DIRECTIONS.includes(direction as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid direction' });
    }
    if (!RECORDING_STATUSES.includes(status as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid status' });
    }

    const [created] = await db
      .insert(voiceRecordings)
      .values({
        departmentId,
        channelId: body.channelId || null,
        callId: body.callId || null,
        source: body.source || 'live_ptt',
        direction,
        status,
        speakerUserId: body.speakerUserId || null,
        speakerLabel: body.speakerLabel || null,
        note: body.note || null,
        filePath: body.filePath || null,
        fileSize: body.fileSize || null,
        mimeType: body.mimeType || 'audio/webm',
        durationSec: body.durationSec || null,
        startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
        endedAt: body.endedAt ? new Date(body.endedAt) : null,
        createdBy: sub,
      })
      .returning();

    return reply.code(201).send({ success: true, data: created });
  });

  // PATCH /api/voice-recordings/:id - update status/file metadata
  app.patch<{
    Params: { id: string };
    Body: {
      status?: string;
      filePath?: string | null;
      fileSize?: number | null;
      mimeType?: string | null;
      durationSec?: number | null;
      endedAt?: string | null;
      note?: string | null;
    };
  }>('/:id', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };
    if (roleLevel < DISPATCHER_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;
    const body = request.body || {};

    if (body.status && !RECORDING_STATUSES.includes(body.status as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid status' });
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const key of ['status', 'filePath', 'fileSize', 'mimeType', 'durationSec', 'note'] as const) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (body.endedAt !== undefined) updates.endedAt = body.endedAt ? new Date(body.endedAt) : null;

    const [updated] = await db
      .update(voiceRecordings)
      .set(updates)
      .where(and(eq(voiceRecordings.id, id), eq(voiceRecordings.departmentId, departmentId)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Voice recording not found' });
    }

    return { success: true, data: updated };
  });

  // GET /api/voice-recordings/:id/stream - stream recorded audio if file exists
  app.get<{ Params: { id: string } }>('/:id/stream', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [recording] = await db
      .select({
        id: voiceRecordings.id,
        filePath: voiceRecordings.filePath,
        mimeType: voiceRecordings.mimeType,
      })
      .from(voiceRecordings)
      .where(and(eq(voiceRecordings.id, id), eq(voiceRecordings.departmentId, departmentId)))
      .limit(1);

    if (!recording) {
      return reply.code(404).send({ success: false, error: 'Voice recording not found' });
    }

    if (!recording.filePath) {
      return reply.code(404).send({ success: false, error: 'Recording audio is not available yet' });
    }

    // PTT recordings use absolute paths starting with /recordings; remap to RECORDINGS_PATH for host dev.
    // Uploaded audio library files use paths relative to VOICE_UPLOAD_DIR.
    const filePath = recording.filePath.startsWith('/recordings')
      ? path.join(RECORDINGS_PATH, recording.filePath.slice('/recordings'.length))
      : path.isAbsolute(recording.filePath)
        ? recording.filePath
        : path.join(VOICE_UPLOAD_DIR, recording.filePath);
    if (!existsSync(filePath)) {
      return reply.code(404).send({ success: false, error: 'Recording file missing from disk' });
    }

    const stat = statSync(filePath);
    const fileSize = stat.size;
    const mimeType = recording.mimeType || 'audio/ogg';
    const disposition = `inline; filename="${recording.id}${path.extname(recording.filePath || '.ogg')}"`;
    const rangeHeader = (request.headers as Record<string, string>)['range'];

    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const stream = createReadStream(filePath, { start, end });
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', String(chunkSize))
        .header('Content-Type', mimeType)
        .header('Content-Disposition', disposition)
        .send(stream);
    }

    const stream = createReadStream(filePath);
    return reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', String(fileSize))
      .header('Content-Type', mimeType)
      .header('Content-Disposition', disposition)
      .send(stream);
  });

  // GET /api/voice-recordings/:id/download - download the clip transcoded to MP3.
  // Clips are stored as OGG/Opus (LiveKit egress); MP3 is universally playable, so
  // we transcode on the fly with ffmpeg (in the API image). Streamed (chunked).
  app.get<{ Params: { id: string } }>('/:id/download', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [recording] = await db
      .select({ id: voiceRecordings.id, filePath: voiceRecordings.filePath })
      .from(voiceRecordings)
      .where(and(eq(voiceRecordings.id, id), eq(voiceRecordings.departmentId, departmentId)))
      .limit(1);
    if (!recording || !recording.filePath) {
      return reply.code(404).send({ success: false, error: 'Recording audio is not available' });
    }
    const filePath = recording.filePath.startsWith('/recordings')
      ? path.join(RECORDINGS_PATH, recording.filePath.slice('/recordings'.length))
      : path.isAbsolute(recording.filePath)
        ? recording.filePath
        : path.join(VOICE_UPLOAD_DIR, recording.filePath);
    if (!existsSync(filePath)) {
      return reply.code(404).send({ success: false, error: 'Recording file missing from disk' });
    }

    // -q:a 4 ≈ ~128-160 kbps VBR — plenty for voice, small files.
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-codec:a', 'libmp3lame', '-q:a', '4', '-f', 'mp3', 'pipe:1']);
    ff.on('error', (err) => {
      request.log.error({ err }, 'ffmpeg spawn failed');
      if (!reply.sent) reply.code(500).send({ success: false, error: 'Transcode failed' });
    });
    ff.stderr.on('data', (d: Buffer) => request.log.debug(d.toString()));
    request.raw.on('close', () => ff.kill('SIGKILL'));

    return reply
      .header('Content-Type', 'audio/mpeg')
      .header('Content-Disposition', `attachment; filename="${recording.id}.mp3"`)
      .header('Cache-Control', 'no-store')
      .send(ff.stdout);
  });

  // DELETE /api/voice-recordings/:id - delete recording record + file from disk
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };
    if (roleLevel < 80) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = request.params;

    const [recording] = await db
      .select({ id: voiceRecordings.id, filePath: voiceRecordings.filePath })
      .from(voiceRecordings)
      .where(and(eq(voiceRecordings.id, id), eq(voiceRecordings.departmentId, departmentId)))
      .limit(1);

    if (!recording) return reply.code(404).send({ success: false, error: 'Not found' });

    if (recording.filePath) {
      const filePath = recording.filePath.startsWith('/recordings')
        ? path.join(RECORDINGS_PATH, recording.filePath.slice('/recordings'.length))
        : recording.filePath;
      try { (await import('fs')).unlinkSync(filePath); } catch { /* file may already be gone */ }
    }

    await db.delete(voiceRecordings).where(eq(voiceRecordings.id, id));
    return { success: true };
  });

  // POST /api/voice-recordings/bulk-delete - delete many recordings (rows + files)
  app.post<{ Body: { ids: string[] } }>('/bulk-delete', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };
    if (roleLevel < 80) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((x) => typeof x === 'string') : [];
    if (ids.length === 0) return reply.code(400).send({ success: false, error: 'ids[] required' });

    const rows = await db
      .select({ id: voiceRecordings.id, filePath: voiceRecordings.filePath })
      .from(voiceRecordings)
      .where(and(inArray(voiceRecordings.id, ids), eq(voiceRecordings.departmentId, departmentId)));

    for (const r of rows) {
      if (!r.filePath) continue;
      const fp = r.filePath.startsWith('/recordings')
        ? path.join(RECORDINGS_PATH, r.filePath.slice('/recordings'.length))
        : r.filePath;
      try { unlinkSync(fp); } catch { /* file may already be gone */ }
    }
    const foundIds = rows.map((r) => r.id);
    if (foundIds.length > 0) {
      await db.delete(voiceRecordings).where(and(inArray(voiceRecordings.id, foundIds), eq(voiceRecordings.departmentId, departmentId)));
    }
    return { success: true, data: { deleted: foundIds.length } };
  });

  // GET /api/voice-recordings/config - help text for ingestion service integration
  app.get('/config', async () => {
    return {
      success: true,
      data: {
        source: 'live_ptt',
        acceptedDirections: RECORDING_DIRECTIONS,
        statuses: RECORDING_STATUSES,
        streamBasePath: '/api/voice-recordings/:id/stream',
      },
    };
  });
}
