import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { eq, and, or, ilike, asc, desc, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { devices } from '../db/schema/devices.js';
import { groups } from '../db/schema/groups.js';
import { groupMembers } from '../db/schema/group-members.js';
import { customStates } from '../db/schema/custom-states.js';
import { userStates } from '../db/schema/user-states.js';
import { ADMIN_LEVEL } from '@pushcomm/shared';
import { broadcast } from '../ws/broadcast.js';
import { getOnlineUserIds } from '../ws/ws-manager.js';

const STATUS_FALLBACKS: Record<string, { label: string; color: string }> = {
  available: { label: 'Available', color: '#22c55e' },
  busy: { label: 'Busy', color: '#a855f7' },
  en_route: { label: 'En Route', color: '#38bdf8' },
  on_scene: { label: 'On Scene', color: '#f59e0b' },
  break: { label: 'Break', color: '#64748b' },
  unavailable: { label: 'Unavailable', color: '#ef4444' },
  off_duty: { label: 'Off Duty', color: '#64748b' },
  emergency: { label: 'Emergency', color: '#dc2626' },
};

function fallbackStatusLabel(state: string | null): string | null {
  if (!state) return null;
  return STATUS_FALLBACKS[state]?.label ?? state.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Unwrap Drizzle's DrizzleQueryError → underlying postgres error and, when it's
 * a unique-constraint violation (SQLSTATE 23505), return a user-friendly
 * message naming the conflicting column. Returns null if not a uniqueness error.
 */
function uniqueConstraintMessage(err: any): string | null {
  const cause = err?.cause ?? err;
  if (!cause || cause.code !== '23505') return null;
  const constraint: string = cause.constraint_name ?? cause.constraint ?? '';
  const detail: string = cause.detail ?? '';
  if (constraint.includes('email') || /\(email\)/.test(detail)) return 'Email already in use';
  if (constraint.includes('username') || /\(username\)/.test(detail)) return 'Username already in use';
  return 'A user with these details already exists';
}

function fallbackStatusColor(state: string | null): string | null {
  if (!state) return null;
  return STATUS_FALLBACKS[state]?.color ?? '#94a3b8';
}

const userSelect = {
  id: users.id,
  departmentId: users.departmentId,
  email: users.email,
  username: users.username,
  firstName: users.firstName,
  lastName: users.lastName,
  device: users.device,
  phone: users.phone,
  address: users.address,
  city: users.city,
  state: users.state,
  zipCode: users.zipCode,
  notes: users.notes,
  role: users.role,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

export async function userRoutes(app: FastifyInstance) {
  type UserRow = typeof users.$inferSelect;

  async function attachGroupInfo(rows: UserRow[], departmentId: string) {
    if (rows.length === 0) return [];
    const userIds = rows.map((u) => u.id);
    const onlineSet = new Set(getOnlineUserIds(departmentId));

    const memberships = await db
      .select({
        userId: groupMembers.userId,
        groupId: groups.id,
        groupName: groups.name,
        joinedAt: groupMembers.joinedAt,
      })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(inArray(groupMembers.userId, userIds), eq(groups.isDeleted, false)))
      .orderBy(asc(groupMembers.joinedAt));

    const primaryByUser = new Map<string, { groupId: string; groupName: string }>();
    for (const m of memberships) {
      if (!primaryByUser.has(m.userId)) {
        primaryByUser.set(m.userId, { groupId: m.groupId, groupName: m.groupName });
      }
    }

    const rawStates = await db
      .select({
        userId: userStates.userId,
        state: userStates.state,
        timestamp: userStates.timestamp,
        label: customStates.buttonText,
        color: customStates.buttonColor,
      })
      .from(userStates)
      .leftJoin(customStates, eq(customStates.id, userStates.customStateId))
      .where(inArray(userStates.userId, userIds))
      .orderBy(desc(userStates.timestamp))
      .limit(3000);

    const statusByUser = new Map<string, {
      state: string;
      timestamp: Date;
      label: string | null;
      color: string | null;
    }>();
    for (const row of rawStates) {
      if (!row.userId || statusByUser.has(row.userId)) continue;
      statusByUser.set(row.userId, row);
    }

    // Assigned-device enrichment. Users have a 1:1 relationship with devices
    // via devices.assigned_user_id. We surface it under `assignedDevice` so
    // the dashboard can render a "Device: talkpodone" label and the user
    // edit form can prefill the dropdown.
    const deviceRows = await db
      .select({
        userId: devices.assignedUserId,
        id: devices.id,
        name: devices.name,
        status: devices.status,
      })
      .from(devices)
      .where(and(
        eq(devices.departmentId, departmentId),
        eq(devices.isDeleted, false),
        inArray(devices.assignedUserId, userIds),
      ));
    const deviceByUser = new Map<string, { id: string; name: string; status: string }>();
    for (const d of deviceRows) {
      if (d.userId) deviceByUser.set(d.userId, { id: d.id, name: d.name, status: d.status });
    }

    return rows.map((u) => {
      const gm = primaryByUser.get(u.id);
      const status = statusByUser.get(u.id);
      const dev = deviceByUser.get(u.id);
      return {
        ...u,
        groupId: gm?.groupId ?? null,
        groupName: gm?.groupName ?? null,
        assignedDevice: dev ?? null,
        isOnline: onlineSet.has(u.id),
        status: status?.state ?? null,
        statusLabel: status?.label ?? fallbackStatusLabel(status?.state ?? null),
        statusColor: status?.color ?? fallbackStatusColor(status?.state ?? null),
        statusAt: status?.timestamp ? status.timestamp.toISOString() : null,
      };
    });
  }

  /**
   * Atomically rebind a user's assigned device, enforcing 1:1.
   * Pass deviceId = null to unassign whatever device the user currently has.
   * Throws if the requested device doesn't exist in the department or is
   * currently assigned to a different user (the dropdown filter prevents
   * this in normal UX but the server validates anyway).
   */
  async function setUserAssignedDevice(params: {
    userId: string;
    departmentId: string;
    deviceId: string | null;
  }) {
    const { userId, departmentId, deviceId } = params;

    // Always clear any device currently owned by this user — the assignment
    // is 1:1 so any rebind starts with a clean slate.
    await db
      .update(devices)
      .set({ assignedUserId: null, updatedAt: new Date() })
      .where(and(
        eq(devices.departmentId, departmentId),
        eq(devices.assignedUserId, userId),
      ));

    if (!deviceId) return;

    const [target] = await db
      .select({ id: devices.id, assignedUserId: devices.assignedUserId })
      .from(devices)
      .where(and(
        eq(devices.id, deviceId),
        eq(devices.departmentId, departmentId),
        eq(devices.isDeleted, false),
      ))
      .limit(1);

    if (!target) throw new Error('device not found');
    if (target.assignedUserId && target.assignedUserId !== userId) {
      throw new Error('device already assigned to another user');
    }

    await db
      .update(devices)
      .set({ assignedUserId: userId, updatedAt: new Date() })
      .where(eq(devices.id, deviceId));
  }

  async function setUserPrimaryGroup(params: { userId: string; departmentId: string; groupId?: string | null }) {
    const { userId, departmentId, groupId } = params;

    // Treat group assignment as single-primary for now.
    await db.delete(groupMembers).where(eq(groupMembers.userId, userId));

    if (!groupId) return;

    const [group] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.departmentId, departmentId), eq(groups.isDeleted, false)))
      .limit(1);

    if (!group) {
      throw new Error('Invalid group');
    }

    await db.insert(groupMembers).values({ groupId: group.id, userId }).onConflictDoNothing();
  }

  // All user routes require authentication
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/users/me — Current user profile
  app.get('/me', async (request, reply) => {
    const { sub } = request.user as { sub: string };

    const [user] = await db
      .select(userSelect)
      .from(users)
      .where(and(eq(users.id, sub), eq(users.isDeleted, false)))
      .limit(1);

    if (!user) {
      return reply.code(404).send({ success: false, error: 'User not found' });
    }

    const [enriched] = await attachGroupInfo([user as UserRow], user.departmentId);
    return { success: true, data: enriched };
  });

  // GET /api/users — List users with pagination, search, role, and personnel-status filters
  app.get<{
    Querystring: { page?: string; limit?: string; search?: string; role?: string; status?: string; maxRoleLevel?: string; unassigned?: string; includeDeviceId?: string };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const search = request.query.search?.trim();
    const roleFilter = request.query.role;
    const statusFilter = request.query.status;
    const maxRoleLevel = request.query.maxRoleLevel !== undefined
      ? parseInt(request.query.maxRoleLevel, 10)
      : undefined;
    // Used by the Device form's "User" dropdown to show only users who
    // don't have a device yet + the user this device is already assigned
    // to (so it remains the visible selection while editing).
    const unassignedOnly = request.query.unassigned === 'true';
    const includeDeviceId = request.query.includeDeviceId?.trim() || null;

    const conditions: any[] = [eq(users.departmentId, departmentId), eq(users.isDeleted, false)];

    if (roleFilter) {
      conditions.push(eq(users.role, roleFilter));
    }

    if (unassignedOnly) {
      // "Unassigned user" = no row in devices where assigned_user_id =
      // users.id. If includeDeviceId is supplied, allow the user currently
      // assigned to THAT device to also appear in the list.
      conditions.push(
        sql`(
          NOT EXISTS (
            SELECT 1 FROM devices d
            WHERE d.assigned_user_id = ${users.id}
              AND d.department_id = ${users.departmentId}
              AND d.is_deleted = false
          )
          ${includeDeviceId ? sql`OR EXISTS (
            SELECT 1 FROM devices d2
            WHERE d2.id = ${includeDeviceId}
              AND d2.assigned_user_id = ${users.id}
              AND d2.is_deleted = false
          )` : sql``}
        )`,
      );
    }

    if (statusFilter && statusFilter !== 'all') {
      conditions.push(
        sql`coalesce((
          SELECT user_states.state
          FROM user_states
          WHERE user_states.user_id = ${users.id}
          ORDER BY user_states.timestamp DESC
          LIMIT 1
        ), '') = ${statusFilter}`,
      );
    }

    if (maxRoleLevel !== undefined) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM roles
          WHERE roles.name = ${users.role}
            AND roles.department_id = ${users.departmentId}
            AND roles.hierarchy_level < ${maxRoleLevel}
            AND roles.is_deleted = false
        )`,
      );
    }

    if (search) {
      conditions.push(
        or(
          ilike(users.firstName, `%${search}%`),
          ilike(users.lastName, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(users.username, `%${search}%`),
          // Concatenated full name so "First Last" matches as one query.
          ilike(sql`concat(${users.firstName}, ' ', ${users.lastName})`, `%${search}%`),
        )!,
      );
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(whereClause);

    const result = await db
      .select(userSelect)
      .from(users)
      .where(whereClause)
      .orderBy(asc(users.lastName), asc(users.firstName))
      .limit(limit)
      .offset(offset);

    const enriched = await attachGroupInfo(result as UserRow[], departmentId);

    return {
      success: true,
      data: enriched,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  });

  // GET /api/users/:id
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [user] = await db
      .select(userSelect)
      .from(users)
      .where(and(eq(users.id, id), eq(users.departmentId, departmentId), eq(users.isDeleted, false)))
      .limit(1);

    if (!user) {
      return reply.code(404).send({ success: false, error: 'User not found' });
    }

    const [enriched] = await attachGroupInfo([user as UserRow], departmentId);
    return { success: true, data: enriched };
  });

  // POST /api/users — Create user (admin+ only)
  app.post<{
    Body: {
      email?: string;
      username: string;
      password: string;
      firstName: string;
      lastName: string;
      device?: string;
      deviceId?: string | null;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      notes?: string;
      role?: string;
      groupId?: string | null;
    };
  }>('/', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { email, username, password, firstName, lastName, device, deviceId, phone, address, city, state, zipCode, notes, role, groupId } = request.body;
    const normalizedRole = role || 'not_assigned';

    if (!username || !password || !firstName || !lastName) {
      return reply.code(400).send({ success: false, error: 'Missing required fields' });
    }

    // Community Edition has no seat cap — unlimited users, by design.

    const normalizedEmail = email?.trim() ? email.trim() : null;

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const [user] = await db
        .insert(users)
        .values({
          departmentId,
          email: normalizedEmail,
          username,
          passwordHash,
          firstName,
          lastName,
          device,
          phone,
          address,
          city,
          state,
          zipCode,
          notes,
          role: normalizedRole,
        })
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          device: users.device,
          phone: users.phone,
          address: users.address,
          city: users.city,
          state: users.state,
          zipCode: users.zipCode,
          notes: users.notes,
          role: users.role,
          createdAt: users.createdAt,
        });

      if (groupId !== undefined) {
        try {
          await setUserPrimaryGroup({ userId: user.id, departmentId, groupId });
        } catch {
          return reply.code(400).send({ success: false, error: 'Invalid group' });
        }
      }

      if (deviceId !== undefined) {
        try {
          await setUserAssignedDevice({ userId: user.id, departmentId, deviceId });
        } catch (err: any) {
          return reply.code(400).send({ success: false, error: err?.message ?? 'Invalid device' });
        }
      }

      broadcast(departmentId, { event: 'user:created', userId: user.id, timestamp: new Date().toISOString() });
      const [enriched] = await attachGroupInfo([user as UserRow], departmentId);
      return reply.code(201).send({ success: true, data: enriched });
    } catch (err: any) {
      const conflict = uniqueConstraintMessage(err);
      if (conflict) return reply.code(409).send({ success: false, error: conflict });
      throw err;
    }
  });

  // PATCH /api/users/:id — Update user
  app.patch<{
    Params: { id: string };
    Body: {
      email?: string;
      username?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      device?: string;
      deviceId?: string | null;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      notes?: string;
      role?: string;
      isActive?: boolean;
      groupId?: string | null;
    };
  }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;
    const { groupId, password, deviceId, ...updates } = request.body;

    if (password !== undefined) {
      if (!password || password.length < 6) {
        return reply.code(400).send({ success: false, error: 'Password must be at least 6 characters' });
      }
      (updates as any).passwordHash = await bcrypt.hash(password, 12);
    }

    let updated: any;
    try {
      [updated] = await db
        .update(users)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(users.id, id), eq(users.departmentId, departmentId), eq(users.isDeleted, false)))
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          device: users.device,
          phone: users.phone,
          address: users.address,
          city: users.city,
          state: users.state,
          zipCode: users.zipCode,
          notes: users.notes,
          role: users.role,
          isActive: users.isActive,
        });
    } catch (err: any) {
      const conflict = uniqueConstraintMessage(err);
      if (conflict) return reply.code(409).send({ success: false, error: conflict });
      throw err;
    }

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'User not found' });
    }

    if (groupId !== undefined) {
      try {
        await setUserPrimaryGroup({ userId: id, departmentId, groupId });
      } catch {
        return reply.code(400).send({ success: false, error: 'Invalid group' });
      }
    }

    if (deviceId !== undefined) {
      try {
        await setUserAssignedDevice({ userId: id, departmentId, deviceId });
      } catch (err: any) {
        return reply.code(400).send({ success: false, error: err?.message ?? 'Invalid device' });
      }
    }

    broadcast(departmentId, { event: 'user:updated', userId: updated.id, timestamp: new Date().toISOString() });
    const [enriched] = await attachGroupInfo([updated as UserRow], departmentId);
    return { success: true, data: enriched };
  });

  // DELETE /api/users/:id — Soft delete
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId, sub } = request.user as { roleLevel: number; departmentId: string; sub: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;

    if (id === sub) {
      return reply.code(400).send({ success: false, error: 'Cannot delete yourself' });
    }

    const [deleted] = await db
      .update(users)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.departmentId, departmentId), eq(users.isDeleted, false)))
      .returning({ id: users.id });

    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'User not found' });
    }

    broadcast(departmentId, { event: 'user:deleted', userId: id, timestamp: new Date().toISOString() });
    return { success: true, message: 'User deleted' };
  });
}
