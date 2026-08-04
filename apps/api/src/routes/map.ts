import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { roles } from '../db/schema/roles.js';
import { locations } from '../db/schema/locations.js';
import { groupMembers } from '../db/schema/group-members.js';
import { groups } from '../db/schema/groups.js';
import { customStates } from '../db/schema/custom-states.js';
import { userStates } from '../db/schema/user-states.js';
import { getOnlineUserIds } from '../ws/ws-manager.js';

// Users with roleLevel >= this are excluded from the field map (dispatchers, admins)
const DISPATCHER_LEVEL = 40;

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

function fallbackStatusColor(state: string | null): string | null {
  if (!state) return null;
  return STATUS_FALLBACKS[state]?.color ?? '#94a3b8';
}

export async function mapRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/map/overview
  app.get('/overview', async (request) => {
    const { departmentId, sub } = request.user as { departmentId: string; sub: string };

    // Only show field units (roleLevel < 40) that currently have an active WS connection
    const onlineIds = getOnlineUserIds(departmentId);
    const [requester] = await db
      .select({
        roleLevel: roles.hierarchyLevel,
      })
      .from(users)
      .innerJoin(
        roles,
        and(eq(roles.name, users.role), eq(roles.departmentId, users.departmentId), eq(roles.isDeleted, false)),
      )
      .where(and(eq(users.id, sub), eq(users.departmentId, departmentId), eq(users.isDeleted, false)))
      .limit(1);

    let visibleOnlineIds = onlineIds;

    // Field users should only see online teammates in their own group(s).
    // Dispatchers/admins keep the full department field map used by Dispatch.
    if ((requester?.roleLevel ?? 0) < DISPATCHER_LEVEL) {
      const requesterGroups = await db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(and(eq(groupMembers.userId, sub), eq(groups.isDeleted, false)));

      const requesterGroupIds = requesterGroups.map((row) => row.groupId);
      const otherOnlineIds = onlineIds.filter((id) => id !== sub);

      if (requesterGroupIds.length === 0 || otherOnlineIds.length === 0) {
        visibleOnlineIds = [];
      } else {
        const teammateRows = await db
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .innerJoin(groups, eq(groups.id, groupMembers.groupId))
          .where(and(
            inArray(groupMembers.groupId, requesterGroupIds),
            inArray(groupMembers.userId, otherOnlineIds),
            eq(groups.isDeleted, false),
          ));

        visibleOnlineIds = Array.from(new Set(teammateRows.map((row) => row.userId)));
      }
    }

    const departmentUserRows = visibleOnlineIds.length === 0 ? [] : await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(users)
      .innerJoin(
        roles,
        and(eq(roles.name, users.role), eq(roles.departmentId, users.departmentId), eq(roles.isDeleted, false)),
      )
      .where(and(
        eq(users.departmentId, departmentId),
        eq(users.isDeleted, false),
        inArray(users.id, visibleOnlineIds),
        lt(roles.hierarchyLevel, DISPATCHER_LEVEL),
      ));

    const departmentUsers = Array.from(
      new Map(departmentUserRows.map((user) => [user.id, user])).values(),
    );

    const userIds = departmentUsers.map((u) => u.id);
    const groupRows = userIds.length === 0 ? [] : await db
      .select({
        userId: groupMembers.userId,
        groupId: groups.id,
        groupName: groups.name,
      })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(inArray(groupMembers.userId, userIds), eq(groups.isDeleted, false)))
      .orderBy(asc(groupMembers.joinedAt));
    const primaryGroupByUser = new Map<string, { groupId: string; groupName: string }>();
    for (const row of groupRows) {
      if (!primaryGroupByUser.has(row.userId)) {
        primaryGroupByUser.set(row.userId, { groupId: row.groupId, groupName: row.groupName });
      }
    }

    let latestByUser: Array<{
      userId: string | null;
      latitude: string;
      longitude: string;
      timestamp: Date;
    }> = [];

    if (userIds.length > 0) {
      const raw = await db
        .select({
          userId: locations.userId,
          latitude: locations.latitude,
          longitude: locations.longitude,
          timestamp: locations.timestamp,
        })
        .from(locations)
        .where(inArray(locations.userId, userIds))
        .orderBy(desc(locations.timestamp))
        .limit(3000);

      const seen = new Set<string>();
      latestByUser = raw.filter((row) => {
        if (!row.userId) return false;
        if (seen.has(row.userId)) return false;
        seen.add(row.userId);
        return true;
      });
    }

    const latestMap = new Map(latestByUser.map((r) => [r.userId!, r]));

    const rawStates = userIds.length === 0 ? [] : await db
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

    const drivers = departmentUsers
      .map((u) => {
        const latest = latestMap.get(u.id);
        const status = statusByUser.get(u.id);
        const primaryGroup = primaryGroupByUser.get(u.id);
        const lat = latest ? Number(latest.latitude) : null;
        const lon = latest ? Number(latest.longitude) : null;
        return {
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
          groupId: primaryGroup?.groupId ?? null,
          groupName: primaryGroup?.groupName ?? null,
          latitude: Number.isFinite(lat) ? lat : null,
          longitude: Number.isFinite(lon) ? lon : null,
          lastLocationAt: latest?.timestamp ? new Date(latest.timestamp).toISOString() : null,
          status: status?.state ?? null,
          statusLabel: status?.label ?? fallbackStatusLabel(status?.state ?? null),
          statusColor: status?.color ?? fallbackStatusColor(status?.state ?? null),
          statusAt: status?.timestamp ? new Date(status.timestamp).toISOString() : null,
        };
      })
      .filter((d) => d.latitude !== null && d.longitude !== null);

    // Compute bounds from actual GPS points
    const allPoints = [
      ...drivers.map((d) => ({ lat: d.latitude!, lon: d.longitude! })),
    ].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

    const boundsHint =
      allPoints.length > 0
        ? {
            region: 'live',
            minLat: Math.min(...allPoints.map((p) => p.lat)),
            maxLat: Math.max(...allPoints.map((p) => p.lat)),
            minLon: Math.min(...allPoints.map((p) => p.lon)),
            maxLon: Math.max(...allPoints.map((p) => p.lon)),
          }
        : { region: '', minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };

    return {
      success: true,
      data: {
        drivers,
        boundsHint,
      },
    };
  });
}
