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
import { eq, and, ilike, asc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { audioLibrary } from '../db/schema/audio-library.js';
import { users } from '../db/schema/users.js';
import { AUDIO_CATEGORIES, ADMIN_LEVEL } from '@pushcomm/shared';
import { randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, unlinkSync, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'audio');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];

export async function audioLibraryRoutes(app: FastifyInstance) {
  // Ensure upload directory exists
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/audio-library — List audio files with pagination and category filter
  app.get<{
    Querystring: { page?: string; limit?: string; category?: string; search?: string };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const categoryFilter = request.query.category;
    const search = request.query.search?.trim();

    const conditions: any[] = [eq(audioLibrary.departmentId, departmentId)];

    if (categoryFilter && AUDIO_CATEGORIES.includes(categoryFilter as any)) {
      conditions.push(eq(audioLibrary.category, categoryFilter));
    }

    if (search) {
      conditions.push(ilike(audioLibrary.filename, `%${search}%`));
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(audioLibrary)
      .where(whereClause);

    const uploader = db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .as('uploader');

    const result = await db
      .select({
        id: audioLibrary.id,
        filename: audioLibrary.filename,
        fileSize: audioLibrary.fileSize,
        duration: audioLibrary.duration,
        mimeType: audioLibrary.mimeType,
        category: audioLibrary.category,
        createdAt: audioLibrary.createdAt,
        uploaderFirstName: uploader.firstName,
        uploaderLastName: uploader.lastName,
      })
      .from(audioLibrary)
      .leftJoin(uploader, eq(audioLibrary.uploadedBy, uploader.id))
      .where(whereClause)
      .orderBy(asc(audioLibrary.filename))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: result,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  });

  // POST /api/audio-library — Upload audio file (multipart)
  app.post('/', async (request, reply) => {
    const { sub, departmentId } = request.user as { sub: string; departmentId: string };

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ success: false, error: 'No file uploaded' });
    }

    // Validate mime type
    if (!ALLOWED_MIME.includes(data.mimetype)) {
      return reply.code(400).send({ success: false, error: 'Invalid file type. Allowed: MP3, WAV, OGG, M4A, WebM' });
    }

    // Get category from fields
    const categoryField = data.fields.category;
    const category = (categoryField as any)?.value || 'standard';
    if (!AUDIO_CATEGORIES.includes(category as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid category' });
    }

    // Generate unique filename
    const ext = path.extname(data.filename) || '.mp3';
    const storedName = `${randomUUID()}${ext}`;
    const filePath = path.join(UPLOAD_DIR, storedName);

    // Stream to disk
    let fileSize = 0;
    const writeStream = createWriteStream(filePath);

    try {
      // We need to track size as we write
      const file = data.file;
      file.on('data', (chunk: Buffer) => {
        fileSize += chunk.length;
        if (fileSize > MAX_FILE_SIZE) {
          file.destroy(new Error('File too large'));
        }
      });

      await pipeline(file, writeStream);
    } catch (err: any) {
      // Clean up partial file
      try { unlinkSync(filePath); } catch {}
      if (err.message === 'File too large') {
        return reply.code(400).send({ success: false, error: 'File exceeds 10MB limit' });
      }
      throw err;
    }

    const [created] = await db
      .insert(audioLibrary)
      .values({
        departmentId,
        filename: data.filename,
        filePath: storedName,
        fileSize,
        mimeType: data.mimetype,
        category,
        uploadedBy: sub,
      })
      .returning();

    return reply.code(201).send({ success: true, data: created });
  });

  // GET /api/audio-library/:id/stream — Stream audio file
  app.get<{ Params: { id: string } }>('/:id/stream', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [audio] = await db
      .select()
      .from(audioLibrary)
      .where(and(eq(audioLibrary.id, id), eq(audioLibrary.departmentId, departmentId)))
      .limit(1);

    if (!audio) {
      return reply.code(404).send({ success: false, error: 'Audio file not found' });
    }

    const filePath = path.join(UPLOAD_DIR, audio.filePath);
    if (!existsSync(filePath)) {
      return reply.code(404).send({ success: false, error: 'File missing from disk' });
    }

    const stream = createReadStream(filePath);
    return reply
      .header('Content-Type', audio.mimeType || 'audio/mpeg')
      .header('Content-Disposition', `inline; filename="${audio.filename}"`)
      .send(stream);
  });

  // DELETE /api/audio-library/:id — Delete audio file
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;

    const [deleted] = await db
      .delete(audioLibrary)
      .where(and(eq(audioLibrary.id, id), eq(audioLibrary.departmentId, departmentId)))
      .returning();

    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'Audio file not found' });
    }

    // Remove file from disk
    const filePath = path.join(UPLOAD_DIR, deleted.filePath);
    try { unlinkSync(filePath); } catch {}

    return { success: true, message: 'Audio file deleted' };
  });
}
