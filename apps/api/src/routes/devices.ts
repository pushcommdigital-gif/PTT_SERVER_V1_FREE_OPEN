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
import { createHash, randomBytes } from 'crypto';
import { eq, and, ilike, asc, sql, or, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { devices } from '../db/schema/devices.js';
import { users } from '../db/schema/users.js';
import { groups } from '../db/schema/groups.js';
import { groupMembers } from '../db/schema/group-members.js';
import { roles } from '../db/schema/roles.js';
import { config } from '../config.js';
import { ADMIN_LEVEL } from '@pushcomm/shared';
import { broadcast } from '../ws/broadcast.js';

const PROVISIONING_CODE_TTL_MS = 30 * 60 * 1000;

function hashProvisioningCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

function getApiServerUrl(request: any): string {
  const proto = (request.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || request.protocol || 'https';
  // Self-hosted: derive the URL from the request. No fallback to any vendor
  // domain — a provisioning QR must only ever point at this deployment.
  const host = (request.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim()
    || request.headers.host
    || '';
  if (!host) throw new Error('Cannot determine the API host for device provisioning');
  const apiHost = String(host)
    .replace(/^manage\./i, 'api.')
    .replace(/^dispatch\./i, 'api.');
  return `${proto}://${apiHost}`.replace(/\/$/, '');
}

async function getRoleLevel(departmentId: string, roleName: string): Promise<number> {
  const [role] = await db
    .select({ hierarchyLevel: roles.hierarchyLevel })
    .from(roles)
    .where(and(eq(roles.departmentId, departmentId), eq(roles.name, roleName), eq(roles.isDeleted, false)))
    .limit(1);
  const dbLevel = role?.hierarchyLevel ?? 0;
  if (roleName === 'dispatcher' && dbLevel < ADMIN_LEVEL) return ADMIN_LEVEL;
  return dbLevel;
}

async function getPrimaryUserGroupId(userId: string, departmentId: string): Promise<string | null> {
  const [membership] = await db
    .select({ groupId: groups.id })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), eq(groups.departmentId, departmentId), eq(groups.isDeleted, false)))
    .orderBy(asc(groupMembers.joinedAt))
    .limit(1);

  return membership?.groupId ?? null;
}

export async function deviceRoutes(app: FastifyInstance) {
  // --- Public activation endpoint (no auth) ---
  app.post<{
    Body: { imei: string; provisioningKey: string; firmwareVersion?: string };
  }>('/activate', async (request, reply) => {
    const { imei, provisioningKey, firmwareVersion } = request.body;

    if (!imei || !provisioningKey) {
      return reply.code(400).send({ success: false, error: 'IMEI and provisioning key are required' });
    }

    const [device] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.imei, imei), eq(devices.provisioningKey, provisioningKey), eq(devices.isDeleted, false)))
      .limit(1);

    if (!device) {
      return reply.code(401).send({ success: false, error: 'Invalid IMEI or provisioning key' });
    }

    if (device.status === 'disabled') {
      return reply.code(403).send({ success: false, error: 'Device is disabled' });
    }

    const assignedGroupId =
      device.assignedGroupId ?? (device.assignedUserId ? await getPrimaryUserGroupId(device.assignedUserId, device.departmentId) : null);

    // Update device status
    const ip = request.ip;
    await db
      .update(devices)
      .set({
        status: 'active',
        lastSeenAt: new Date(),
        firmwareVersion: firmwareVersion || device.firmwareVersion,
        ipAddress: ip,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, device.id));

    // Sign a device JWT (30 days)
    const token = app.jwt.sign(
      {
        sub: device.id,
        type: 'device',
        imei: device.imei,
        departmentId: device.departmentId,
        assignedUserId: device.assignedUserId,
        assignedGroupId,
      },
      { expiresIn: '30d' },
    );

    broadcast(device.departmentId, { event: 'device:updated', deviceId: device.id, timestamp: new Date().toISOString() });

    return reply.send({
      success: true,
      data: {
        token,
        device: {
          id: device.id,
          name: device.name,
          departmentId: device.departmentId,
          assignedUserId: device.assignedUserId,
          assignedGroupId,
        },
      },
    });
  });

  // POST /api/devices/provision — QR/manual provisioning code -> normal user session.
  // The device must already be assigned to a user. Codes are one-time and short-lived.
  app.post<{
    Body: { code: string; firmwareVersion?: string };
  }>('/provision', async (request, reply) => {
    const code = request.body.code?.trim();
    if (!code) {
      return reply.code(400).send({ success: false, error: 'Provisioning code is required' });
    }

    const codeHash = hashProvisioningCode(code);
    const now = new Date();
    const [row] = await db
      .select({
        device: devices,
        user: users,
      })
      .from(devices)
      .innerJoin(users, eq(devices.assignedUserId, users.id))
      .where(
        and(
          eq(devices.provisioningCodeHash, codeHash),
          gt(devices.provisioningCodeExpiresAt, now),
          eq(devices.isDeleted, false),
          eq(users.isDeleted, false),
        ),
      )
      .limit(1);

    if (!row) {
      return reply.code(401).send({ success: false, error: 'Invalid or expired provisioning code' });
    }

    if (row.device.status === 'disabled') {
      return reply.code(403).send({ success: false, error: 'Device is disabled' });
    }

    if (!row.user.isActive) {
      return reply.code(403).send({ success: false, error: 'Assigned user account is deactivated' });
    }

    const assignedGroupId = row.device.assignedGroupId ?? await getPrimaryUserGroupId(row.user.id, row.device.departmentId);

    const roleLevel = await getRoleLevel(row.user.departmentId, row.user.role);
    const payload = {
      sub: row.user.id,
      email: row.user.email,
      role: row.user.role,
      roleLevel,
      departmentId: row.user.departmentId,
    };

    const accessToken = app.jwt.sign(payload, { expiresIn: config.jwt.accessExpiry });
    const refreshToken = app.jwt.sign({ sub: row.user.id, type: 'refresh' }, { expiresIn: config.jwt.refreshExpiry });

    await db.transaction(async (tx) => {
      await tx
        .update(devices)
        .set({
          status: 'active',
          lastSeenAt: now,
          firmwareVersion: request.body.firmwareVersion || row.device.firmwareVersion,
          ipAddress: request.ip,
          provisioningCodeHash: null,
          provisioningCodeExpiresAt: null,
          provisionedAt: now,
          updatedAt: now,
        })
        .where(eq(devices.id, row.device.id));

      await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, row.user.id));
    });

    broadcast(row.device.departmentId, { event: 'device:updated', deviceId: row.device.id, timestamp: now.toISOString() });

    return reply.send({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: row.user.id,
          email: row.user.email,
          username: row.user.username,
          firstName: row.user.firstName,
          lastName: row.user.lastName,
          role: row.user.role,
          departmentId: row.user.departmentId,
        },
        device: {
          id: row.device.id,
          name: row.device.name,
          imei: row.device.imei,
          departmentId: row.device.departmentId,
          assignedUserId: row.device.assignedUserId,
          assignedGroupId,
        },
      },
    });
  });

  // --- All remaining routes require auth ---
  app.addHook('onRequest', async (request, reply) => {
    // Skip auth for public device activation/provisioning endpoints.
    const path = request.url.split('?')[0];
    if (path.endsWith('/activate') || path.endsWith('/provision')) return;
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/devices — List with pagination, search, status filter
  app.get<{
    Querystring: { page?: string; limit?: string; search?: string; status?: string; unassigned?: string; includeUserId?: string };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const search = request.query.search?.trim();
    const statusFilter = request.query.status;
    // Used by the User form's "Device" dropdown so an editor sees only
    // devices that are free to assign + the device this user already owns
    // (so it shows up as the current selection rather than disappearing).
    const unassignedOnly = request.query.unassigned === 'true';
    const includeUserId = request.query.includeUserId?.trim() || null;

    const conditions: any[] = [eq(devices.departmentId, departmentId), eq(devices.isDeleted, false)];

    if (unassignedOnly) {
      if (includeUserId) {
        conditions.push(
          or(isNull(devices.assignedUserId), eq(devices.assignedUserId, includeUserId))!,
        );
      } else {
        conditions.push(isNull(devices.assignedUserId));
      }
    }

    if (statusFilter && ['pending', 'active', 'disabled'].includes(statusFilter)) {
      conditions.push(eq(devices.status, statusFilter));
    }

    if (search) {
      conditions.push(
        or(
          ilike(devices.name, `%${search}%`),
          ilike(devices.imei, `%${search}%`),
          ilike(devices.model, `%${search}%`),
        )!,
      );
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(whereClause);

    const assignedUser = db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .as('assigned_user');

    const assignedGroup = db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .as('assigned_group');

    const result = await db
      .select({
        id: devices.id,
        departmentId: devices.departmentId,
        imei: devices.imei,
        name: devices.name,
        model: devices.model,
        assignedUserId: devices.assignedUserId,
        assignedGroupId: devices.assignedGroupId,
        status: devices.status,
        lastSeenAt: devices.lastSeenAt,
        firmwareVersion: devices.firmwareVersion,
        ipAddress: devices.ipAddress,
        createdAt: devices.createdAt,
        assignedUserFirstName: assignedUser.firstName,
        assignedUserLastName: assignedUser.lastName,
        assignedGroupName: assignedGroup.name,
      })
      .from(devices)
      .leftJoin(assignedUser, eq(devices.assignedUserId, assignedUser.id))
      .leftJoin(assignedGroup, eq(devices.assignedGroupId, assignedGroup.id))
      .where(whereClause)
      .orderBy(asc(devices.name))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: result,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  });

  // GET /api/devices/:id
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [device] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.departmentId, departmentId), eq(devices.isDeleted, false)))
      .limit(1);

    if (!device) {
      return reply.code(404).send({ success: false, error: 'Device not found' });
    }

    return { success: true, data: device };
  });

  // POST /api/devices — create a device record for QR/user provisioning.
  app.post<{
    Body: {
      imei?: string;
      name: string;
      model?: string;
      assignedUserId?: string;
      assignedGroupId?: string;
    };
  }>('/', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { imei, name, model, assignedUserId, assignedGroupId } = request.body;
    const deviceIdentifier = imei?.trim() || `pc-${randomBytes(8).toString('hex')}`;

    if (!name) {
      return reply.code(400).send({ success: false, error: 'Device name is required' });
    }

    if (!/^[A-Za-z0-9_-]{3,20}$/.test(deviceIdentifier)) {
      return reply.code(400).send({
        success: false,
        error: 'Device ID must be 3-20 letters, numbers, dashes, or underscores',
      });
    }

    // Check for duplicate device identifier in this department.
    const [existing] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.departmentId, departmentId), eq(devices.imei, deviceIdentifier), eq(devices.isDeleted, false)))
      .limit(1);

    if (existing) {
      return reply.code(409).send({ success: false, error: 'A device with this ID already exists' });
    }

    const provisioningKey = randomBytes(32).toString('hex');

    const [created] = await db
      .insert(devices)
      .values({
        departmentId,
        imei: deviceIdentifier,
        name,
        model: model || null,
        assignedUserId: assignedUserId || null,
        assignedGroupId: assignedGroupId || null,
        provisioningKey,
        status: 'pending',
      })
      .returning();

    broadcast(departmentId, { event: 'device:created', deviceId: created.id, timestamp: new Date().toISOString() });
    const { provisioningKey: _hiddenProvisioningKey, ...safeCreated } = created;
    return reply.code(201).send({ success: true, data: safeCreated });
  });

  // POST /api/devices/:id/provisioning-qr — generate one-time QR/manual code.
  app.post<{ Params: { id: string } }>('/:id/provisioning-qr', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;
    const [device] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.departmentId, departmentId), eq(devices.isDeleted, false)))
      .limit(1);

    if (!device) {
      return reply.code(404).send({ success: false, error: 'Device not found' });
    }

    if (!device.assignedUserId) {
      return reply.code(400).send({ success: false, error: 'Assign this device to a user before generating a QR code' });
    }

    if (device.status === 'disabled') {
      return reply.code(400).send({ success: false, error: 'Enable this device before generating a QR code' });
    }

    const provisioningCode = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + PROVISIONING_CODE_TTL_MS);

    await db
      .update(devices)
      .set({
        provisioningCodeHash: hashProvisioningCode(provisioningCode),
        provisioningCodeExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, device.id));

    const payload = {
      type: 'pushcomm-device-provisioning',
      version: 1,
      serverUrl: getApiServerUrl(request),
      code: provisioningCode,
      expiresAt: expiresAt.toISOString(),
    };

    broadcast(departmentId, { event: 'device:updated', deviceId: device.id, timestamp: new Date().toISOString() });

    return {
      success: true,
      data: {
        provisioningCode,
        expiresAt: expiresAt.toISOString(),
        payload,
      },
    };
  });

  // PATCH /api/devices/:id
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      model?: string;
      assignedUserId?: string | null;
      assignedGroupId?: string | null;
      status?: string;
    };
  }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;
    const body = request.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const key of ['name', 'model', 'assignedUserId', 'assignedGroupId'] as const) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (body.status && ['pending', 'active', 'disabled'].includes(body.status)) {
      updates.status = body.status;
    }

    const [updated] = await db
      .update(devices)
      .set(updates)
      .where(and(eq(devices.id, id), eq(devices.departmentId, departmentId), eq(devices.isDeleted, false)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Device not found' });
    }

    broadcast(departmentId, { event: 'device:updated', deviceId: updated.id, timestamp: new Date().toISOString() });
    return { success: true, data: updated };
  });

  // DELETE /api/devices/:id — Soft delete
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;

    const [deleted] = await db
      .update(devices)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(eq(devices.id, id), eq(devices.departmentId, departmentId), eq(devices.isDeleted, false)))
      .returning({ id: devices.id });

    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'Device not found' });
    }

    broadcast(departmentId, { event: 'device:deleted', deviceId: id, timestamp: new Date().toISOString() });
    return { success: true, message: 'Device deleted' };
  });
}
