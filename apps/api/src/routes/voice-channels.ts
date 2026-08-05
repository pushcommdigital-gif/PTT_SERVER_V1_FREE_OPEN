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
import { eq, and, asc, sql, inArray } from 'drizzle-orm';
import { AccessToken } from 'livekit-server-sdk';
import { db } from '../db/index.js';
import { voiceChannels } from '../db/schema/voice-channels.js';
import { voiceChannelGroups } from '../db/schema/voice-channel-groups.js';
import { voiceChannelUsers } from '../db/schema/voice-channel-users.js';
import { groupMembers } from '../db/schema/group-members.js';
import { groups } from '../db/schema/groups.js';
import { users } from '../db/schema/users.js';
import { devices } from '../db/schema/devices.js';
import { ADMIN_LEVEL, DISPATCHER_LEVEL } from '@pushcomm/shared';
import { config } from '../config.js';
import { broadcast } from '../ws/broadcast.js';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function normalizeIdList(values?: string[]): string[] {
  if (!values) return [];
  return Array.from(new Set(values.filter((v) => typeof v === 'string' && v.trim().length > 0)));
}

function buildChannelAccessCondition(userId: string) {
  return sql`(
    exists (
      select 1
      from ${voiceChannelUsers} vcu
      where vcu.channel_id = ${voiceChannels.id}
        and vcu.user_id = ${userId}
    )
    or exists (
      select 1
      from ${voiceChannelGroups} vcg
      inner join ${groupMembers} gm on gm.group_id = vcg.group_id
      where vcg.channel_id = ${voiceChannels.id}
        and gm.user_id = ${userId}
    )
    or (
      not exists (
        select 1
        from ${voiceChannelUsers} vcu_empty
        where vcu_empty.channel_id = ${voiceChannels.id}
      )
      and not exists (
        select 1
        from ${voiceChannelGroups} vcg_empty
        where vcg_empty.channel_id = ${voiceChannels.id}
      )
    )
  )`;
}

async function setChannelAssignments(
  departmentId: string,
  channelId: string,
  groupIds: string[],
  userIds: string[],
) {
  const normalizedGroupIds = normalizeIdList(groupIds);
  const normalizedUserIds = normalizeIdList(userIds);

  if (normalizedGroupIds.length > 0) {
    const validGroups = await db
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(
          eq(groups.departmentId, departmentId),
          eq(groups.isDeleted, false),
          inArray(groups.id, normalizedGroupIds),
        ),
      );

    if (validGroups.length !== normalizedGroupIds.length) {
      throw new Error('One or more assigned groups are invalid');
    }
  }

  if (normalizedUserIds.length > 0) {
    const validUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.departmentId, departmentId),
          eq(users.isDeleted, false),
          inArray(users.id, normalizedUserIds),
        ),
      );

    if (validUsers.length !== normalizedUserIds.length) {
      throw new Error('One or more assigned users are invalid');
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(voiceChannelGroups).where(eq(voiceChannelGroups.channelId, channelId));
    await tx.delete(voiceChannelUsers).where(eq(voiceChannelUsers.channelId, channelId));

    if (normalizedGroupIds.length > 0) {
      await tx.insert(voiceChannelGroups).values(
        normalizedGroupIds.map((groupId) => ({
          channelId,
          groupId,
        })),
      );
    }

    if (normalizedUserIds.length > 0) {
      await tx.insert(voiceChannelUsers).values(
        normalizedUserIds.map((userId) => ({
          channelId,
          userId,
        })),
      );
    }
  });
}

export async function voiceChannelRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/voice-channels - List channels (filtered by assignment for non-admin users)
  app.get('/', async (request) => {
    const { sub, departmentId, roleLevel } = request.user as {
      sub: string;
      departmentId: string;
      roleLevel: number;
    };

    const whereConditions = [
      eq(voiceChannels.departmentId, departmentId),
      eq(voiceChannels.isDeleted, false),
    ];

    // Dispatchers and above see all channels in their department. Field
    // users (below dispatcher level) are filtered by direct/group assignment.
    if (roleLevel < DISPATCHER_LEVEL) {
      whereConditions.push(buildChannelAccessCondition(sub) as any);
    }

    const channels = await db
      .select({
        id: voiceChannels.id,
        name: voiceChannels.name,
        livekitRoom: voiceChannels.livekitRoom,
        displayOrder: voiceChannels.displayOrder,
        isDefault: voiceChannels.isDefault,
        createdAt: voiceChannels.createdAt,
        updatedAt: voiceChannels.updatedAt,
      })
      .from(voiceChannels)
      .where(and(...whereConditions))
      .orderBy(asc(voiceChannels.displayOrder), asc(voiceChannels.name));

    const channelIds = channels.map((c) => c.id);
    const groupCountByChannel = new Map<string, number>();
    const userCountByChannel = new Map<string, number>();

    if (channelIds.length > 0) {
      const [groupCounts, userCounts] = await Promise.all([
        db
          .select({
            channelId: voiceChannelGroups.channelId,
            count: sql<number>`count(*)::int`,
          })
          .from(voiceChannelGroups)
          .where(inArray(voiceChannelGroups.channelId, channelIds))
          .groupBy(voiceChannelGroups.channelId),
        db
          .select({
            channelId: voiceChannelUsers.channelId,
            count: sql<number>`count(*)::int`,
          })
          .from(voiceChannelUsers)
          .where(inArray(voiceChannelUsers.channelId, channelIds))
          .groupBy(voiceChannelUsers.channelId),
      ]);

      for (const row of groupCounts) {
        groupCountByChannel.set(row.channelId, row.count);
      }
      for (const row of userCounts) {
        userCountByChannel.set(row.channelId, row.count);
      }
    }

    return {
      success: true,
      data: channels.map((channel) => ({
        ...channel,
        assignedGroupCount: groupCountByChannel.get(channel.id) ?? 0,
        assignedUserCount: userCountByChannel.get(channel.id) ?? 0,
      })),
    };
  });

  // GET /api/voice-channels/:id - Channel details including assignment lists
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { sub, departmentId, roleLevel } = request.user as {
      sub: string;
      departmentId: string;
      roleLevel: number;
    };
    const { id } = request.params;

    const whereConditions = [
      eq(voiceChannels.id, id),
      eq(voiceChannels.departmentId, departmentId),
      eq(voiceChannels.isDeleted, false),
    ];
    // Dispatchers and above see all channels in their department. Field
    // users (below dispatcher level) are filtered by direct/group assignment.
    if (roleLevel < DISPATCHER_LEVEL) {
      whereConditions.push(buildChannelAccessCondition(sub) as any);
    }

    const [channel] = await db
      .select()
      .from(voiceChannels)
      .where(and(...whereConditions))
      .limit(1);

    if (!channel) {
      return reply.code(404).send({ success: false, error: 'Voice channel not found' });
    }

    const [assignedGroups, assignedUsers] = await Promise.all([
      db
        .select({ groupId: voiceChannelGroups.groupId, name: groups.name })
        .from(voiceChannelGroups)
        .innerJoin(groups, eq(groups.id, voiceChannelGroups.groupId))
        .where(eq(voiceChannelGroups.channelId, channel.id))
        .orderBy(asc(groups.name)),
      db
        .select({
          userId: voiceChannelUsers.userId,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        })
        .from(voiceChannelUsers)
        .innerJoin(users, eq(users.id, voiceChannelUsers.userId))
        .where(eq(voiceChannelUsers.channelId, channel.id))
        .orderBy(asc(users.lastName), asc(users.firstName)),
    ]);

    return {
      success: true,
      data: {
        ...channel,
        assignedGroups,
        assignedUsers,
      },
    };
  });

  // POST /api/voice-channels - Create channel (admin only)
  app.post<{
    Body: { name: string; displayOrder?: number; isDefault?: boolean; groupIds?: string[]; userIds?: string[] };
  }>('/', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Admin access required' });
    }

    const { name, displayOrder, isDefault, groupIds, userIds } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ success: false, error: 'Name is required' });
    }

    const livekitRoom = `dept_${departmentId.slice(0, 8)}_${slugify(name)}_${Date.now()}`;

    const [created] = await db
      .insert(voiceChannels)
      .values({
        departmentId,
        name: name.trim(),
        livekitRoom,
        displayOrder: displayOrder ?? 0,
        isDefault: isDefault ?? false,
      })
      .returning();

    try {
      await setChannelAssignments(departmentId, created.id, groupIds ?? [], userIds ?? []);
    } catch (err: any) {
      return reply.code(400).send({ success: false, error: err.message || 'Invalid channel assignments' });
    }

    broadcast(departmentId, { event: 'voice_channel:created', channelId: created.id, timestamp: new Date().toISOString() });
    return reply.code(201).send({ success: true, data: created });
  });

  // PATCH /api/voice-channels/:id - Update channel and optional assignments (admin only)
  app.patch<{
    Params: { id: string };
    Body: { name?: string; displayOrder?: number; isDefault?: boolean; groupIds?: string[]; userIds?: string[] };
  }>('/:id', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Admin access required' });
    }

    const { id } = request.params;
    const { name, displayOrder, isDefault, groupIds, userIds } = request.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (displayOrder !== undefined) updates.displayOrder = displayOrder;
    if (isDefault !== undefined) updates.isDefault = isDefault;

    const [updated] = await db
      .update(voiceChannels)
      .set(updates)
      .where(and(eq(voiceChannels.id, id), eq(voiceChannels.departmentId, departmentId), eq(voiceChannels.isDeleted, false)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Voice channel not found' });
    }

    if (groupIds !== undefined || userIds !== undefined) {
      try {
        await setChannelAssignments(departmentId, id, groupIds ?? [], userIds ?? []);
      } catch (err: any) {
        return reply.code(400).send({ success: false, error: err.message || 'Invalid channel assignments' });
      }
    }

    broadcast(departmentId, { event: 'voice_channel:updated', channelId: id, timestamp: new Date().toISOString() });
    return { success: true, data: updated };
  });

  // PUT /api/voice-channels/:id/assignments - Replace assignments (admin only)
  app.put<{
    Params: { id: string };
    Body: { groupIds?: string[]; userIds?: string[] };
  }>('/:id/assignments', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Admin access required' });
    }

    const { id } = request.params;
    const { groupIds = [], userIds = [] } = request.body;

    const [channel] = await db
      .select({ id: voiceChannels.id })
      .from(voiceChannels)
      .where(and(eq(voiceChannels.id, id), eq(voiceChannels.departmentId, departmentId), eq(voiceChannels.isDeleted, false)))
      .limit(1);

    if (!channel) {
      return reply.code(404).send({ success: false, error: 'Voice channel not found' });
    }

    try {
      await setChannelAssignments(departmentId, id, groupIds, userIds);
    } catch (err: any) {
      return reply.code(400).send({ success: false, error: err.message || 'Invalid channel assignments' });
    }

    broadcast(departmentId, { event: 'voice_channel:updated', channelId: id, timestamp: new Date().toISOString() });
    return { success: true, data: { id, groupIds: normalizeIdList(groupIds), userIds: normalizeIdList(userIds) } };
  });

  // DELETE /api/voice-channels/:id - Soft delete (admin only)
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId, roleLevel } = request.user as { departmentId: string; roleLevel: number };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Admin access required' });
    }

    const { id } = request.params;

    const [deleted] = await db
      .update(voiceChannels)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(eq(voiceChannels.id, id), eq(voiceChannels.departmentId, departmentId), eq(voiceChannels.isDeleted, false)))
      .returning();

    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'Voice channel not found' });
    }

    broadcast(departmentId, { event: 'voice_channel:deleted', channelId: id, timestamp: new Date().toISOString() });
    return { success: true, data: { id } };
  });

  // GET /api/voice-channels/:id/members-summary - Effective expected members for channel
  app.get<{ Params: { id: string } }>('/:id/members-summary', async (request, reply) => {
    const { sub, departmentId, roleLevel } = request.user as {
      sub: string;
      departmentId: string;
      roleLevel: number;
    };
    const { id } = request.params;

    const whereConditions = [
      eq(voiceChannels.id, id),
      eq(voiceChannels.departmentId, departmentId),
      eq(voiceChannels.isDeleted, false),
    ];
    // Dispatchers and above see all channels in their department. Field
    // users (below dispatcher level) are filtered by direct/group assignment.
    if (roleLevel < DISPATCHER_LEVEL) {
      whereConditions.push(buildChannelAccessCondition(sub) as any);
    }

    const [channel] = await db
      .select({
        id: voiceChannels.id,
        name: voiceChannels.name,
        livekitRoom: voiceChannels.livekitRoom,
      })
      .from(voiceChannels)
      .where(and(...whereConditions))
      .limit(1);

    if (!channel) {
      return reply.code(404).send({ success: false, error: 'Voice channel not found' });
    }

    const [assignedGroups, directUsers, groupUsers] = await Promise.all([
      db
        .select({ groupId: voiceChannelGroups.groupId, name: groups.name })
        .from(voiceChannelGroups)
        .innerJoin(groups, eq(groups.id, voiceChannelGroups.groupId))
        .where(eq(voiceChannelGroups.channelId, channel.id))
        .orderBy(asc(groups.name)),
      db
        .select({
          userId: voiceChannelUsers.userId,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        })
        .from(voiceChannelUsers)
        .innerJoin(users, eq(users.id, voiceChannelUsers.userId))
        .where(and(eq(voiceChannelUsers.channelId, channel.id), eq(users.isDeleted, false)))
        .orderBy(asc(users.lastName), asc(users.firstName)),
      db
        .select({
          userId: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
          groupId: groups.id,
          groupName: groups.name,
        })
        .from(voiceChannelGroups)
        .innerJoin(groups, eq(groups.id, voiceChannelGroups.groupId))
        .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
        .innerJoin(users, eq(users.id, groupMembers.userId))
        .where(
          and(
            eq(voiceChannelGroups.channelId, channel.id),
            eq(groups.isDeleted, false),
            eq(users.isDeleted, false),
          ),
        ),
    ]);

    const expectedMemberMap = new Map<
      string,
      {
        userId: string;
        firstName: string;
        lastName: string;
        role: string;
        viaDirect: boolean;
        viaGroups: Array<{ groupId: string; groupName: string }>;
      }
    >();

    for (const user of directUsers) {
      expectedMemberMap.set(user.userId, {
        userId: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        viaDirect: true,
        viaGroups: [],
      });
    }

    for (const user of groupUsers) {
      const existing = expectedMemberMap.get(user.userId);
      const groupLink = { groupId: user.groupId, groupName: user.groupName };
      if (!existing) {
        expectedMemberMap.set(user.userId, {
          userId: user.userId,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          viaDirect: false,
          viaGroups: [groupLink],
        });
      } else if (!existing.viaGroups.some((g) => g.groupId === user.groupId)) {
        existing.viaGroups.push(groupLink);
      }
    }

    const expectedMembers = Array.from(expectedMemberMap.values()).sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
    );

    return {
      success: true,
      data: {
        channel,
        assignedGroups,
        directUsers,
        expectedMembers,
      },
    };
  });

  // POST /api/voice-channels/:id/token - Generate LiveKit token
  // Any authenticated department member may request a token; assignment-based
  // filtering (below) ensures they can only join channels they belong to.
  app.post<{ Params: { id: string } }>('/:id/token', async (request, reply) => {
    const { sub, departmentId, roleLevel } = request.user as { sub: string; departmentId: string; roleLevel: number };

    if (!config.livekit.apiKey || !config.livekit.apiSecret) {
      return reply.code(503).send({ success: false, error: 'LiveKit is not configured' });
    }

    const whereConditions = [
      eq(voiceChannels.id, request.params.id),
      eq(voiceChannels.departmentId, departmentId),
      eq(voiceChannels.isDeleted, false),
    ];
    // Dispatchers and above see all channels in their department. Field
    // users (below dispatcher level) are filtered by direct/group assignment.
    if (roleLevel < DISPATCHER_LEVEL) {
      whereConditions.push(buildChannelAccessCondition(sub) as any);
    }

    const [channel] = await db
      .select()
      .from(voiceChannels)
      .where(and(...whereConditions))
      .limit(1);

    if (!channel) {
      return reply.code(403).send({ success: false, error: 'Channel access denied' });
    }

    const [user] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);

    let participantName: string;
    if (user) {
      participantName = `${user.firstName} ${user.lastName}`;
    } else {
      // Caller is a device (IMEI auth) — use the device name for floor control display
      const [device] = await db
        .select({ name: devices.name })
        .from(devices)
        .where(eq(devices.id, sub))
        .limit(1);
      participantName = device?.name ?? sub;
    }

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: sub,
      name: participantName,
      ttl: '24h',
    });
    at.addGrant({
      room: channel.livekitRoom,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return {
      success: true,
      data: {
        token,
        livekitUrl: config.livekit.publicUrl,
        roomName: channel.livekitRoom,
      },
    };
  });
}
