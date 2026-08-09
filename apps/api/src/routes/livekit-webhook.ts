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
import type { FastifyInstance } from 'fastify';
import { WebhookReceiver } from 'livekit-server-sdk';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pttSessions } from '../db/schema/ptt-sessions.js';
import { voiceChannels } from '../db/schema/voice-channels.js';
import { voiceRecordings } from '../db/schema/voice-recordings.js';
import { users } from '../db/schema/users.js';
import { config } from '../config.js';
import { rememberTrack, forgetTrack, forgetParticipant, forgetRoom } from '../services/livekit-track-cache.js';
import { noteParticipantLeft, noteParticipantJoined } from '../services/floor-control.js';
import { broadcast } from '../ws/broadcast.js';
import { emitCoreEvent } from '../lib/events.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

async function getDeptAndChannelForRoom(
  roomName: string,
): Promise<{ departmentId: string; channelId: string | null; isPrivate: boolean } | null> {
  // Try group voice channel first
  const [channel] = await db
    .select({ id: voiceChannels.id, departmentId: voiceChannels.departmentId })
    .from(voiceChannels)
    .where(eq(voiceChannels.livekitRoom, roomName))
    .limit(1);

  if (channel) {
    return { departmentId: channel.departmentId, channelId: channel.id, isPrivate: false };
  }

  // Try private call room: private-{uuid1}-{uuid2}
  if (roomName.startsWith('private-')) {
    const uuids = roomName.match(UUID_RE);
    if (uuids && uuids.length >= 1) {
      const [user] = await db
        .select({ departmentId: users.departmentId })
        .from(users)
        .where(eq(users.id, uuids[0]))
        .limit(1);
      if (user) {
        return { departmentId: user.departmentId, channelId: null, isPrivate: true };
      }
    }
  }

  return null;
}

export async function livekitWebhookRoutes(app: FastifyInstance) {
  // Parse raw body (as Buffer) for HMAC signature verification
  // LiveKit sends Content-Type: application/webhook+json
  const rawParser = (_req: any, body: Buffer, done: (err: null, body: Buffer) => void) =>
    done(null, body);
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, rawParser);
  app.addContentTypeParser('application/webhook+json', { parseAs: 'buffer' }, rawParser);

  app.post('/livekit-webhook', async (request, reply) => {
    if (!config.livekit.apiKey || !config.livekit.apiSecret) {
      return reply.code(503).send({ error: 'LiveKit not configured' });
    }

    const bodyStr = (request.body as Buffer).toString('utf8');
    const receiver = new WebhookReceiver(config.livekit.apiKey, config.livekit.apiSecret);

    let event: any;
    try {
      event = await receiver.receive(bodyStr, request.headers['authorization'] as string);
    } catch {
      return reply.code(400).send({ error: 'Invalid webhook signature' });
    }

    const eventType: string = event.event;

    try {
      if (eventType === 'room_started' && event.room) {
        const roomName: string = event.room.name;
        const info = await getDeptAndChannelForRoom(roomName);
        if (info) {
          await db
            .insert(pttSessions)
            .values({
              departmentId: info.departmentId,
              roomName,
              channelId: info.channelId,
              isPrivate: info.isPrivate,
              status: 'active',
            })
            .onConflictDoNothing();
        }
      }

      if (eventType === 'room_finished' && event.room) {
        const roomName: string = event.room.name;
        const endedAt = new Date();
        await db
          .update(pttSessions)
          .set({
            status: 'finished',
            endedAt,
            // Duration = this session's own lifetime (its started_at → now), NOT the
            // LiveKit room's creationTime: rooms are long-lived (a dispatcher monitors
            // for hours), so room age would massively overstate the call. The CDR view
            // refines this further to the actual clip activity span.
            durationSec: sql`GREATEST(0, ROUND(EXTRACT(EPOCH FROM (${endedAt}::timestamptz - ${pttSessions.startedAt}))))::int`,
          })
          .where(and(eq(pttSessions.roomName, roomName), eq(pttSessions.status, 'active')));
      }

      if (
        (eventType === 'participant_joined' || eventType === 'participant_left') &&
        event.room
      ) {
        const roomName: string = event.room.name;
        // Increment max_participant_count if new participant
        if (eventType === 'participant_joined') {
          await db
            .update(pttSessions)
            .set({
              maxParticipantCount: sql`GREATEST(${pttSessions.maxParticipantCount} + 1, ${pttSessions.maxParticipantCount})`,
            })
            .where(and(eq(pttSessions.roomName, roomName), eq(pttSessions.status, 'active')));
        }
      }

      // ── Track lifecycle: keep livekit-track-cache in sync ────────────
      if ((eventType === 'track_published' || eventType === 'track_unpublished') &&
          event.room && event.participant && event.track) {
        const roomName: string = event.room.name;
        const identity: string = event.participant.identity;
        const trackKind = event.track.type ?? event.track.source;
        // We only care about audio tracks (TrackType.AUDIO = 0 in @livekit/protocol).
        // The webhook payload exposes type as a number sometimes and a string ("AUDIO") others.
        const isAudio = trackKind === 0 || trackKind === 'AUDIO' || trackKind === 'audio';
        if (isAudio) {
          if (eventType === 'track_published') {
            rememberTrack(roomName, identity, event.track.sid);
          } else {
            forgetTrack(roomName, identity);
          }
        }
      }

      // Departure. NOTE: the event is `participant_left` — LiveKit has no
      // `participant_disconnected`, and listening for that name meant this
      // whole branch never ran once in production: the floor was never
      // released on a drop (it waited out the 120s lease) and the track cache
      // was never cleared on departure.
      //
      // `participant_connection_aborted` is the same situation earlier in the
      // handshake: the participant never finished connecting.
      if (
        (eventType === 'participant_left' || eventType === 'participant_connection_aborted') &&
        event.room &&
        event.participant
      ) {
        const roomName: string = event.room.name;
        const identity: string = event.participant.identity;
        forgetParticipant(roomName, identity);
        // Deliberately NOT an immediate release: this same event fires on an
        // ordinary reconnect (a handset moving WiFi -> LTE leaves and rejoins
        // ~1.4s later), so releasing here would cut off a live transmission on
        // every network handover. floor-control arms a grace timer that a
        // rejoin cancels.
        noteParticipantLeft(roomName, identity, app.log);
      }

      if (eventType === 'participant_joined' && event.room && event.participant) {
        noteParticipantJoined(event.room.name, event.participant.identity);
      }

      if (eventType === 'room_finished' && event.room) {
        forgetRoom(event.room.name);
      }

      if (eventType === 'egress_ended' && event.egressInfo) {
        const egressId: string = event.egressInfo.egressId;
        // Track egress puts file info in fileResults[] (array); composite puts it in file
        const fileInfo =
          event.egressInfo.file ??
          (event.egressInfo.fileResults as any[] | undefined)?.[0] ??
          null;
        app.log.info({ egressId, fileInfo, egressInfo: event.egressInfo }, 'egress_ended webhook');
        if (egressId) {
          // EGRESS_ABORTED with "Stop called before pipeline could start" =
          // user tapped PTT too briefly for the egress pipeline to begin
          // writing. The audio was heard live but no file was captured.
          // Mark as failed so it doesn't show up under "Ready" with 0 bytes.
          // Header-only/empty captures (a PTT tap too brief for the egress
          // pipeline to write any audio) come back a few hundred bytes with no
          // duration. Treat anything below a sane floor as failed, not ready.
          const MIN_VALID_FILE_SIZE = 1024;
          const fileSize = fileInfo ? Number(fileInfo.size) || 0 : 0;
          const aborted =
            event.egressInfo.status === 'EGRESS_ABORTED' ||
            event.egressInfo.status === 4 ||
            (event.egressInfo.error && event.egressInfo.error.length > 0) ||
            !fileInfo ||
            fileSize < MIN_VALID_FILE_SIZE;

          const updatePayload: Record<string, unknown> = {
            status: aborted ? 'failed' : 'ready',
            endedAt: new Date(),
            updatedAt: new Date(),
          };
          if (aborted) {
            updatePayload.endedReason = 'egress_failed';
            updatePayload.captureError =
              event.egressInfo.error || 'egress produced no audio (clip too short, empty, or pipeline aborted)';
          }
          if (fileInfo) {
            updatePayload.filePath = fileInfo.location || fileInfo.filename || null;
            updatePayload.fileSize = fileInfo.size ? Number(fileInfo.size) : null;
            updatePayload.durationSec = fileInfo.duration
              ? Math.round(Number(fileInfo.duration) / 1_000_000_000)
              : null;
          }
          const [updated] = await db
            .update(voiceRecordings)
            .set(updatePayload as any)
            .where(eq(voiceRecordings.egressId, egressId))
            .returning({
              id: voiceRecordings.id,
              departmentId: voiceRecordings.departmentId,
              speakerLabel: voiceRecordings.speakerLabel,
              targetLabel: voiceRecordings.targetLabel,
              durationSec: voiceRecordings.durationSec,
              startedAt: voiceRecordings.startedAt,
              isSos: voiceRecordings.isSos,
            });

          // Push the finished clip to the dispatch recordings feed.
          if (updated && !aborted) {
            broadcast(updated.departmentId, {
              event: 'recording:ready',
              recordingId: updated.id,
              speakerLabel: updated.speakerLabel,
              targetLabel: updated.targetLabel,
              channelName: null,
              durationSec: updated.durationSec,
              startedAt: (updated.startedAt instanceof Date ? updated.startedAt : new Date(updated.startedAt)).toISOString(),
              isSos: updated.isSos,
            });

            // EXTENSION POINT — add-ons (e.g. transcription) subscribe here.
            // The core emits and forgets; it has no knowledge of subscribers.
            emitCoreEvent('recording:finalized', {
              recordingId: updated.id,
              departmentId: updated.departmentId,
            });
          }
        }
      }
    } catch (err) {
      app.log.error(err, `livekit-webhook: error handling ${eventType}`);
    }

    return reply.code(200).send({ ok: true });
  });
}
