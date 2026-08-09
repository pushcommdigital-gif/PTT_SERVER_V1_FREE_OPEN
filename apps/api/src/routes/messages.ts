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
import { eq, and, or, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { messages } from '../db/schema/messages.js';
import { users } from '../db/schema/users.js';
import { groups } from '../db/schema/groups.js';
import { groupMembers } from '../db/schema/group-members.js';
import { MESSAGE_TYPES } from '@pushcomm/shared';
import { broadcast } from '../ws/broadcast.js';
import { sendFcm } from '../services/fcm.js';
import { randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, createReadStream, unlinkSync } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';

const MSG_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'messages');
const ALLOWED_AUDIO_MIME = ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-m4a', 'audio/aac'];
const IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};
const MAX_VOICE_MSG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGE_MSG_SIZE = 15 * 1024 * 1024; // 15MB

export async function messageRoutes(app: FastifyInstance) {
  // Ensure voice message upload directory exists
  if (!existsSync(MSG_UPLOAD_DIR)) {
    mkdirSync(MSG_UPLOAD_DIR, { recursive: true });
  }

  app.addHook('onRequest', async (request, reply) => {
    // Support token via query string for audio streaming (browser <audio> element)
    const rawUrl = request.url || '';
    const qMatch = rawUrl.match(/[?&]token=([^&]+)/);
    if (qMatch && !request.headers.authorization) {
      request.headers.authorization = `Bearer ${decodeURIComponent(qMatch[1])}`;
    }
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/messages — List messages with pagination + filters
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      type?: string;
      targetUserId?: string;
      targetGroupId?: string;
    };
  }>('/', async (request) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '50', 10)));
    const offset = (page - 1) * limit;
    const typeFilter = request.query.type;
    const targetUserId = request.query.targetUserId;
    const targetGroupId = request.query.targetGroupId;

    const conditions: any[] = [
      eq(messages.departmentId, departmentId),
    ];

    if (typeFilter && MESSAGE_TYPES.includes(typeFilter as any)) {
      conditions.push(eq(messages.type, typeFilter));
    }

    if (targetUserId) {
      // Direct thread: show both directions between the two users
      conditions.push(
        or(
          and(eq(messages.senderId, sub), eq(messages.targetUserId, targetUserId)),
          and(eq(messages.senderId, targetUserId), eq(messages.targetUserId, sub)),
        )!,
      );
    } else if (targetGroupId) {
      // Group thread: only members of the target group can see the thread.
      conditions.push(
        and(
          eq(messages.targetGroupId, targetGroupId),
          sql`EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = ${messages.targetGroupId}
              AND gm.user_id = ${sub}
          )`,
        )!,
      );
    } else {
      // No specific thread filter — apply personal visibility:
      // only show messages the user sent, received directly, or broadcast messages
      conditions.push(
        or(
          eq(messages.senderId, sub),
          eq(messages.targetUserId, sub),
          eq(messages.type, 'broadcast'),
        )!,
      );
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(whereClause);

    const senderUser = db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .as('sender_user');

    const result = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        type: messages.type,
        targetUserId: messages.targetUserId,
        targetGroupId: messages.targetGroupId,
        subject: messages.subject,
        body: messages.body,
        isRead: messages.isRead,
        createdAt: messages.createdAt,
        senderFirstName: senderUser.firstName,
        senderLastName: senderUser.lastName,
      })
      .from(messages)
      .leftJoin(senderUser, eq(messages.senderId, senderUser.id))
      .where(whereClause)
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: result,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  });

  // GET /api/messages/conversations — Conversation thread list
  app.get('/conversations', async (request) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };

    // Direct conversations: find unique conversation partners
    const directConversations = await db.execute(sql`
      WITH ranked AS (
        SELECT
          m.id,
          m.body,
          m.created_at,
          m.is_read,
          m.sender_id,
          m.target_user_id,
          CASE
            WHEN m.sender_id = ${sub} THEN m.target_user_id
            ELSE m.sender_id
          END AS partner_id,
          ROW_NUMBER() OVER (
            PARTITION BY CASE
              WHEN m.sender_id = ${sub} THEN m.target_user_id
              ELSE m.sender_id
            END
            ORDER BY m.created_at DESC
          ) AS rn
        FROM messages m
        WHERE m.department_id = ${departmentId}
          AND m.type = 'direct'
          AND (m.sender_id = ${sub} OR m.target_user_id = ${sub})
      )
      SELECT
        r.partner_id,
        r.body AS last_message,
        r.created_at AS last_message_at,
        r.sender_id AS last_sender_id,
        u.first_name AS partner_first_name,
        u.last_name AS partner_last_name,
        (
          SELECT count(*)::int FROM messages m2
          WHERE m2.department_id = ${departmentId}
            AND m2.type = 'direct'
            AND m2.sender_id = r.partner_id
            AND m2.target_user_id = ${sub}
            AND m2.is_read = false
        ) AS unread_count
      FROM ranked r
      JOIN users u ON u.id = r.partner_id
      WHERE r.rn = 1
      ORDER BY r.created_at DESC
    `);

    // Group conversations: find groups with messages
    const groupConversations = await db.execute(sql`
      WITH ranked AS (
        SELECT
          m.id,
          m.body,
          m.created_at,
          m.is_read,
          m.sender_id,
          m.target_group_id,
          ROW_NUMBER() OVER (
            PARTITION BY m.target_group_id
            ORDER BY m.created_at DESC
          ) AS rn
        FROM messages m
        WHERE m.department_id = ${departmentId}
          AND m.type = 'group'
          AND m.target_group_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = m.target_group_id
              AND gm.user_id = ${sub}
          )
      )
      SELECT
        r.target_group_id AS group_id,
        r.body AS last_message,
        r.created_at AS last_message_at,
        r.sender_id AS last_sender_id,
        g.name AS group_name,
        su.first_name AS sender_first_name,
        su.last_name AS sender_last_name,
        (
          SELECT count(*)::int FROM messages m2
          WHERE m2.department_id = ${departmentId}
            AND m2.type = 'group'
            AND m2.target_group_id = r.target_group_id
            AND m2.sender_id != ${sub}
            AND m2.is_read = false
        ) AS unread_count
      FROM ranked r
      JOIN groups g ON g.id = r.target_group_id
      LEFT JOIN users su ON su.id = r.sender_id
      WHERE r.rn = 1
      ORDER BY r.created_at DESC
    `);

    // Broadcast messages: latest broadcasts
    const broadcastMessages = await db.execute(sql`
      SELECT
        m.id,
        m.body AS last_message,
        m.created_at AS last_message_at,
        m.sender_id,
        m.subject,
        su.first_name AS sender_first_name,
        su.last_name AS sender_last_name,
        m.is_read
      FROM messages m
      LEFT JOIN users su ON su.id = m.sender_id
      WHERE m.department_id = ${departmentId}
        AND m.type = 'broadcast'
      ORDER BY m.created_at DESC
      LIMIT 20
    `);

    return {
      success: true,
      data: {
        direct: [...directConversations],
        group: [...groupConversations],
        broadcast: [...broadcastMessages],
      },
    };
  });

  // GET /api/messages/:id — Single message
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const senderUser = db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .as('sender_user');

    const [message] = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        type: messages.type,
        targetUserId: messages.targetUserId,
        targetGroupId: messages.targetGroupId,
        subject: messages.subject,
        body: messages.body,
        isRead: messages.isRead,
        createdAt: messages.createdAt,
        senderFirstName: senderUser.firstName,
        senderLastName: senderUser.lastName,
      })
      .from(messages)
      .leftJoin(senderUser, eq(messages.senderId, senderUser.id))
      .where(and(eq(messages.id, id), eq(messages.departmentId, departmentId)))
      .limit(1);

    if (!message) {
      return reply.code(404).send({ success: false, error: 'Message not found' });
    }

    return { success: true, data: message };
  });

  // POST /api/messages — Send a message
  app.post<{
    Body: {
      type: string;
      targetUserId?: string;
      targetGroupId?: string;
      subject?: string;
      body: string;
    };
  }>('/', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { type, targetUserId, targetGroupId, subject, body } = request.body;

    if (!body?.trim()) {
      return reply.code(400).send({ success: false, error: 'Message body is required' });
    }

    if (!type || !MESSAGE_TYPES.includes(type as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid message type' });
    }

    if (type === 'direct' && !targetUserId) {
      return reply.code(400).send({ success: false, error: 'targetUserId is required for direct messages' });
    }

    if (type === 'group' && !targetGroupId) {
      return reply.code(400).send({ success: false, error: 'targetGroupId is required for group messages' });
    }

    const [created] = await db
      .insert(messages)
      .values({
        departmentId,
        senderId: sub,
        type,
        targetUserId: type === 'direct' ? targetUserId : null,
        targetGroupId: type === 'group' ? targetGroupId : null,
        subject: subject || null,
        body: body.trim(),
      })
      .returning();

    broadcast(departmentId, {
      event: 'message:created',
      messageId: created.id,
      senderId: sub,
      type,
      targetUserId: created.targetUserId,
      targetGroupId: created.targetGroupId,
      timestamp: new Date().toISOString(),
    });

    // FCM push notifications — fire-and-forget, errors handled inside sendFcm
    if (type !== 'broadcast') {
      const [sender] = await db
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, sub))
        .limit(1);
      const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : '';
      const preview = body.trim().slice(0, 100);

      if (type === 'direct' && targetUserId) {
        const [target] = await db
          .select({ fcmToken: users.fcmToken })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);
        if (target?.fcmToken) {
          sendFcm([target.fcmToken], { type: 'message', senderName, preview });
        }
      } else if (type === 'group' && targetGroupId) {
        const [group] = await db
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.id, targetGroupId))
          .limit(1);
        const memberRows = await db
          .select({ fcmToken: users.fcmToken })
          .from(groupMembers)
          .innerJoin(users, eq(groupMembers.userId, users.id))
          .where(and(eq(groupMembers.groupId, targetGroupId), sql`${groupMembers.userId} != ${sub}`));
        const tokens = memberRows.map((m) => m.fcmToken).filter(Boolean) as string[];
        if (tokens.length) {
          sendFcm(tokens, { type: 'message', senderName, groupName: group?.name ?? '', preview });
        }
      }
    }

    return reply.code(201).send({ success: true, data: created });
  });

  // PATCH /api/messages/mark-read — Bulk mark all unread messages in a conversation as read
  app.patch<{
    Body: { type: string; targetUserId?: string; targetGroupId?: string };
  }>('/mark-read', async (request) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { type, targetUserId, targetGroupId } = request.body;

    if (type === 'direct' && targetUserId) {
      // Mark all messages from the partner directed at me as read
      await db
        .update(messages)
        .set({ isRead: true })
        .where(
          and(
            eq(messages.departmentId, departmentId),
            eq(messages.type, 'direct'),
            eq(messages.senderId, targetUserId),
            eq(messages.targetUserId, sub),
            eq(messages.isRead, false),
          ),
        );
    } else if (type === 'group' && targetGroupId) {
      // Mark all messages in the group (not from me) as read
      await db
        .update(messages)
        .set({ isRead: true })
        .where(
          and(
            eq(messages.departmentId, departmentId),
            eq(messages.type, 'group'),
            eq(messages.targetGroupId, targetGroupId),
            eq(messages.isRead, false),
            sql`${messages.senderId} != ${sub}`,
          ),
        );
    }

    broadcast(departmentId, {
      event: 'message:read',
      readBy: sub,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  });

  // PATCH /api/messages/:id/read — Mark message as read
  app.patch<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { id } = request.params;

    const [updated] = await db
      .update(messages)
      .set({ isRead: true })
      .where(
        and(
          eq(messages.id, id),
          eq(messages.departmentId, departmentId),
          // Only target user can mark as read (or broadcast — anyone)
          or(eq(messages.targetUserId, sub), eq(messages.type, 'broadcast'))!,
        ),
      )
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Message not found or not authorized' });
    }

    broadcast(departmentId, {
      event: 'message:read',
      messageId: id,
      readBy: sub,
      timestamp: new Date().toISOString(),
    });

    return { success: true, data: updated };
  });

  // DELETE /api/messages/:id — Delete message (sender only)
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };
    const { id } = request.params;

    const [deleted] = await db
      .delete(messages)
      .where(
        and(
          eq(messages.id, id),
          eq(messages.departmentId, departmentId),
          eq(messages.senderId, sub), // Only sender can delete
        ),
      )
      .returning();

    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'Message not found or not authorized' });
    }

    return { success: true, data: { id } };
  });

  // POST /api/messages/audio — Upload voice message (multipart)
  app.post<{
    Body: { type: string; targetUserId?: string; targetGroupId?: string };
  }>('/audio', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ success: false, error: 'No file uploaded' });
    }

    if (!ALLOWED_AUDIO_MIME.includes(data.mimetype)) {
      return reply.code(400).send({ success: false, error: 'Invalid file type. Audio files only.' });
    }

    const type = (data.fields.type as any)?.value as string;
    const targetUserId = (data.fields.targetUserId as any)?.value as string | undefined;
    const targetGroupId = (data.fields.targetGroupId as any)?.value as string | undefined;

    if (!type || !MESSAGE_TYPES.includes(type as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid message type' });
    }
    if (type === 'direct' && !targetUserId) {
      return reply.code(400).send({ success: false, error: 'targetUserId required for direct messages' });
    }
    if (type === 'group' && !targetGroupId) {
      return reply.code(400).send({ success: false, error: 'targetGroupId required for group messages' });
    }

    const ext = path.extname(data.filename) || '.webm';
    const storedName = `${randomUUID()}${ext}`;
    const filePath = path.join(MSG_UPLOAD_DIR, storedName);

    let fileSize = 0;
    const writeStream = createWriteStream(filePath);
    try {
      const file = data.file;
      file.on('data', (chunk: Buffer) => {
        fileSize += chunk.length;
        if (fileSize > MAX_VOICE_MSG_SIZE) {
          file.destroy(new Error('File too large'));
        }
      });
      await pipeline(file, writeStream);
    } catch (err: any) {
      try { unlinkSync(filePath); } catch {}
      if (err.message === 'File too large') {
        return reply.code(400).send({ success: false, error: 'Audio exceeds 5MB limit' });
      }
      throw err;
    }

    const [created] = await db
      .insert(messages)
      .values({
        departmentId,
        senderId: sub,
        type,
        targetUserId: type === 'direct' ? targetUserId : null,
        targetGroupId: type === 'group' ? targetGroupId : null,
        body: '[audio]',
        filePath: storedName,
        fileSize,
        mimeType: data.mimetype,
      })
      .returning();

    broadcast(departmentId, {
      event: 'message:created',
      messageId: created.id,
      senderId: sub,
      type,
      targetUserId: created.targetUserId,
      targetGroupId: created.targetGroupId,
      timestamp: new Date().toISOString(),
    });

    return reply.code(201).send({ success: true, data: created });
  });

  // POST /api/messages/attachment — Upload image attachment (multipart)
  app.post<{
    Body: { type: string; targetUserId?: string; targetGroupId?: string };
  }>('/attachment', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ success: false, error: 'No file uploaded' });
    }

    const ext = IMAGE_MIME_TO_EXT[data.mimetype];
    if (!ext) {
      return reply.code(400).send({ success: false, error: 'Invalid file type. Images only.' });
    }

    const type = (data.fields.type as any)?.value as string;
    const targetUserId = (data.fields.targetUserId as any)?.value as string | undefined;
    const targetGroupId = (data.fields.targetGroupId as any)?.value as string | undefined;

    if (!type || !MESSAGE_TYPES.includes(type as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid message type' });
    }
    if (type === 'direct' && !targetUserId) {
      return reply.code(400).send({ success: false, error: 'targetUserId required for direct messages' });
    }
    if (type === 'group' && !targetGroupId) {
      return reply.code(400).send({ success: false, error: 'targetGroupId required for group messages' });
    }

    const messageId = randomUUID();
    const storedName = `${messageId}${ext}`;
    const filePath = path.join(MSG_UPLOAD_DIR, storedName);

    let fileSize = 0;
    const writeStream = createWriteStream(filePath);
    try {
      const file = data.file;
      file.on('data', (chunk: Buffer) => {
        fileSize += chunk.length;
        if (fileSize > MAX_IMAGE_MSG_SIZE) {
          file.destroy(new Error('File too large'));
        }
      });
      await pipeline(file, writeStream);
    } catch (err: any) {
      try { unlinkSync(filePath); } catch {}
      if (err.message === 'File too large') {
        return reply.code(400).send({ success: false, error: 'Image exceeds 15MB limit' });
      }
      throw err;
    }

    const [created] = await db
      .insert(messages)
      .values({
        id: messageId,
        departmentId,
        senderId: sub,
        type,
        targetUserId: type === 'direct' ? targetUserId : null,
        targetGroupId: type === 'group' ? targetGroupId : null,
        body: `[image]/api/messages/${messageId}/file`,
        filePath: storedName,
        fileSize,
        mimeType: data.mimetype,
      })
      .returning();

    broadcast(departmentId, {
      event: 'message:created',
      messageId: created.id,
      senderId: sub,
      type,
      targetUserId: created.targetUserId,
      targetGroupId: created.targetGroupId,
      timestamp: new Date().toISOString(),
    });

    if (type !== 'broadcast') {
      const [sender] = await db
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, sub))
        .limit(1);
      const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : '';
      const preview = 'Photo';

      if (type === 'direct' && targetUserId) {
        const [target] = await db
          .select({ fcmToken: users.fcmToken })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);
        if (target?.fcmToken) {
          sendFcm([target.fcmToken], { type: 'message', senderName, preview });
        }
      } else if (type === 'group' && targetGroupId) {
        const [group] = await db
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.id, targetGroupId))
          .limit(1);
        const memberRows = await db
          .select({ fcmToken: users.fcmToken })
          .from(groupMembers)
          .innerJoin(users, eq(groupMembers.userId, users.id))
          .where(and(eq(groupMembers.groupId, targetGroupId), sql`${groupMembers.userId} != ${sub}`));
        const tokens = memberRows.map((m) => m.fcmToken).filter(Boolean) as string[];
        if (tokens.length) {
          sendFcm(tokens, { type: 'message', senderName, groupName: group?.name ?? '', preview });
        }
      }
    }

    return reply.code(201).send({ success: true, data: created });
  });

  // GET /api/messages/:id/audio — Stream voice message audio file
  app.get<{ Params: { id: string } }>('/:id/audio', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [message] = await db
      .select({
        id: messages.id,
        filePath: messages.filePath,
        mimeType: messages.mimeType,
        departmentId: messages.departmentId,
      })
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.departmentId, departmentId)))
      .limit(1);

    if (!message || !message.filePath) {
      return reply.code(404).send({ success: false, error: 'Audio not found' });
    }

    const fullPath = path.join(MSG_UPLOAD_DIR, message.filePath);
    if (!existsSync(fullPath)) {
      return reply.code(404).send({ success: false, error: 'File missing from disk' });
    }

    const stream = createReadStream(fullPath);
    return reply
      .header('Content-Type', message.mimeType || 'audio/webm')
      .header('Content-Disposition', 'inline')
      .send(stream);
  });

  // GET /api/messages/:id/file — Stream image attachment
  app.get<{ Params: { id: string } }>('/:id/file', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [message] = await db
      .select({
        id: messages.id,
        filePath: messages.filePath,
        mimeType: messages.mimeType,
        departmentId: messages.departmentId,
      })
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.departmentId, departmentId)))
      .limit(1);

    if (!message || !message.filePath || !message.mimeType?.startsWith('image/')) {
      return reply.code(404).send({ success: false, error: 'Image not found' });
    }

    const fullPath = path.join(MSG_UPLOAD_DIR, message.filePath);
    if (!existsSync(fullPath)) {
      return reply.code(404).send({ success: false, error: 'File missing from disk' });
    }

    const stream = createReadStream(fullPath);
    return reply
      .header('Content-Type', message.mimeType)
      .header('Content-Disposition', 'inline')
      .send(stream);
  });
}
