import type { FastifyInstance } from 'fastify';
import { eq, and, ilike, asc, sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { groups } from '../db/schema/groups.js';
import { groupMembers } from '../db/schema/group-members.js';
import { groupTypes } from '../db/schema/group-types.js';
import { users } from '../db/schema/users.js';
import { ADMIN_LEVEL, DISPATCHER_LEVEL } from '@pushcomm/shared';
import { broadcast } from '../ws/broadcast.js';
import { getOnlineUserIds } from '../ws/ws-manager.js';
import { config } from '../config.js';
import { AccessToken } from 'livekit-server-sdk';

export async function groupRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/groups — List groups with pagination, search, and member counts
  app.get<{
    Querystring: { page?: string; limit?: string; search?: string; type?: string };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const search = request.query.search?.trim();
    const typeFilter = request.query.type;

    const conditions: any[] = [eq(groups.departmentId, departmentId), eq(groups.isDeleted, false)];

    if (search) {
      conditions.push(ilike(groups.name, `%${search}%`));
    }
    if (typeFilter) {
      conditions.push(eq(groups.type, typeFilter));
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(groups)
      .where(whereClause);

    const result = await db
      .select({
        id: groups.id,
        departmentId: groups.departmentId,
        parentGroupId: groups.parentGroupId,
        name: groups.name,
        type: groups.type,
        description: groups.description,
        address: groups.address,
        latitude: groups.latitude,
        longitude: groups.longitude,
        createdAt: groups.createdAt,
        updatedAt: groups.updatedAt,
        memberCount: sql<number>`count(${groupMembers.userId})::int`,
      })
      .from(groups)
      .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .where(whereClause)
      .groupBy(
        groups.id,
        groups.departmentId,
        groups.parentGroupId,
        groups.name,
        groups.type,
        groups.description,
        groups.address,
        groups.latitude,
        groups.longitude,
        groups.createdAt,
        groups.updatedAt,
      )
      .orderBy(asc(groups.name))
      .limit(limit)
      .offset(offset);

    const onlineUserIds = getOnlineUserIds(departmentId);
    const onlineCountByGroup = new Map<string, number>();

    if (onlineUserIds.length > 0 && result.length > 0) {
      const groupIds = result.map((g) => g.id);

      const onlineMemberships = await db
        .select({
          groupId: groupMembers.groupId,
          userId: groupMembers.userId,
        })
        .from(groupMembers)
        .where(and(inArray(groupMembers.groupId, groupIds), inArray(groupMembers.userId, onlineUserIds)));

      for (const row of onlineMemberships) {
        onlineCountByGroup.set(row.groupId, (onlineCountByGroup.get(row.groupId) ?? 0) + 1);
      }
    }

    return {
      success: true,
      data: result.map((group) => ({
        ...group,
        onlineMemberCount: onlineCountByGroup.get(group.id) ?? 0,
      })),
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  });

  // GET /api/groups/:id — Get group with members
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [group] = await db
      .select()
      .from(groups)
      .where(and(eq(groups.id, id), eq(groups.departmentId, departmentId), eq(groups.isDeleted, false)))
      .limit(1);

    if (!group) {
      return reply.code(404).send({ success: false, error: 'Group not found' });
    }

    const members = await db
      .select({
        id: groupMembers.id,
        userId: groupMembers.userId,
        isAdmin: groupMembers.isAdmin,
        joinedAt: groupMembers.joinedAt,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
      })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, id));

    const onlineUserIds = getOnlineUserIds(departmentId);
    return {
      success: true,
      data: {
        ...group,
        members: members.map((m) => ({ ...m, isOnline: onlineUserIds.includes(m.userId) })),
      },
    };
  });

  // POST /api/groups/:id/token - Generate LiveKit token for a group room
  app.post<{ Params: { id: string } }>('/:id/token', async (request, reply) => {
    const { sub, departmentId, roleLevel } = request.user as { sub: string; departmentId: string; roleLevel: number };
    const { id } = request.params;

    if (!config.livekit.apiKey || !config.livekit.apiSecret) {
      return reply.code(503).send({ success: false, error: 'LiveKit is not configured' });
    }

    const [group] = await db
      .select({ id: groups.id, name: groups.name, departmentId: groups.departmentId, isDeleted: groups.isDeleted })
      .from(groups)
      .where(and(eq(groups.id, id), eq(groups.departmentId, departmentId), eq(groups.isDeleted, false)))
      .limit(1);

    if (!group) {
      return reply.code(404).send({ success: false, error: 'Group not found' });
    }

    // Non-dispatchers can only connect to groups they are a member of.
    if (roleLevel < DISPATCHER_LEVEL) {
      const [membership] = await db
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, sub)))
        .limit(1);

      if (!membership) {
        return reply.code(403).send({ success: false, error: 'Group access denied' });
      }
    }

    const [user] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);

    const participantName = user ? `${user.firstName} ${user.lastName}` : sub;
    const roomName = `group-${group.id}`;

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: sub,
      name: participantName,
      ttl: '24h',
    });
    at.addGrant({
      room: roomName,
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
        roomName,
      },
    };
  });

  // POST /api/groups — Create group
  app.post<{
    Body: {
      name: string;
      type?: string;
      description?: string;
      parentGroupId?: string;
      address?: string;
      latitude?: string;
      longitude?: string;
    };
  }>('/', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { name, type, description, parentGroupId, address, latitude, longitude } = request.body;

    if (!name) {
      return reply.code(400).send({ success: false, error: 'Group name is required' });
    }

    // Validate type exists in group_types
    const groupType = type || 'group';
    const [validType] = await db
      .select({ id: groupTypes.id })
      .from(groupTypes)
      .where(and(eq(groupTypes.departmentId, departmentId), eq(groupTypes.name, groupType), eq(groupTypes.isDeleted, false)))
      .limit(1);

    if (!validType) {
      return reply.code(400).send({ success: false, error: `Invalid group type: ${groupType}` });
    }

    const [group] = await db
      .insert(groups)
      .values({ departmentId, name, type: groupType, description, parentGroupId, address, latitude, longitude })
      .returning();

    broadcast(departmentId, { event: 'group:created', groupId: group.id, timestamp: new Date().toISOString() });
    return reply.code(201).send({ success: true, data: group });
  });

  // PATCH /api/groups/:id — Update group
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      type?: string;
      description?: string;
      address?: string;
      latitude?: string;
      longitude?: string;
    };
  }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;
    const updates = request.body;

    // Validate type if being changed
    if (updates.type) {
      const [validType] = await db
        .select({ id: groupTypes.id })
        .from(groupTypes)
        .where(and(eq(groupTypes.departmentId, departmentId), eq(groupTypes.name, updates.type), eq(groupTypes.isDeleted, false)))
        .limit(1);

      if (!validType) {
        return reply.code(400).send({ success: false, error: `Invalid group type: ${updates.type}` });
      }
    }

    const [updated] = await db
      .update(groups)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(groups.id, id), eq(groups.departmentId, departmentId), eq(groups.isDeleted, false)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Group not found' });
    }

    broadcast(departmentId, { event: 'group:updated', groupId: updated.id, timestamp: new Date().toISOString() });
    return { success: true, data: updated };
  });

  // POST /api/groups/:id/members — Add member
  app.post<{ Params: { id: string }; Body: { userId: string; isAdmin?: boolean } }>(
    '/:id/members',
    async (request, reply) => {
      const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

      if (roleLevel < DISPATCHER_LEVEL) {
        return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
      }

      const { id } = request.params;
      const { userId, isAdmin } = request.body;

      const [group] = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, id), eq(groups.departmentId, departmentId), eq(groups.isDeleted, false)))
        .limit(1);

      if (!group) {
        return reply.code(404).send({ success: false, error: 'Group not found' });
      }

      try {
        const [member] = await db
          .insert(groupMembers)
          .values({ groupId: id, userId, isAdmin: isAdmin || false })
          .returning();

        broadcast(departmentId, { event: 'group:member_added', groupId: id, userId, timestamp: new Date().toISOString() });
        return reply.code(201).send({ success: true, data: member });
      } catch (err: any) {
        if (err.code === '23505') {
          return reply.code(409).send({ success: false, error: 'User is already a member' });
        }
        throw err;
      }
    },
  );

  // DELETE /api/groups/:id/members/:userId — Remove member
  app.delete<{ Params: { id: string; userId: string } }>(
    '/:id/members/:userId',
    async (request, reply) => {
      const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

      if (roleLevel < DISPATCHER_LEVEL) {
        return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
      }

      const { id, userId } = request.params;

      const [removed] = await db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, userId)))
        .returning({ id: groupMembers.id });

      if (!removed) {
        return reply.code(404).send({ success: false, error: 'Member not found' });
      }

      broadcast(departmentId, { event: 'group:member_removed', groupId: id, userId, timestamp: new Date().toISOString() });
      return { success: true, message: 'Member removed' };
    },
  );

  // DELETE /api/groups/:id — Soft delete group
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;

    const [deleted] = await db
      .update(groups)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(eq(groups.id, id), eq(groups.departmentId, departmentId), eq(groups.isDeleted, false)))
      .returning({ id: groups.id });

    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'Group not found' });
    }

    broadcast(departmentId, { event: 'group:deleted', groupId: id, timestamp: new Date().toISOString() });
    return { success: true, message: 'Group deleted' };
  });
}
