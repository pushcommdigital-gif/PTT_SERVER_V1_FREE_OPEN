import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pointsOfInterest } from '../db/schema/points-of-interest.js';
import { broadcast } from '../ws/broadcast.js';
import { DISPATCHER_LEVEL } from '@pushcomm/shared';

function canManageZones(user: unknown): boolean {
  const roleLevel = (user as { roleLevel?: number } | undefined)?.roleLevel ?? 0;
  return roleLevel >= DISPATCHER_LEVEL;
}

export async function poiRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/pois
  app.get<{ Querystring: { active?: string } }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const { active } = request.query;

    const conditions = [eq(pointsOfInterest.departmentId, departmentId)];
    if (active === 'true') conditions.push(eq(pointsOfInterest.active, true));
    if (active === 'false') conditions.push(eq(pointsOfInterest.active, false));

    const rows = await db
      .select()
      .from(pointsOfInterest)
      .where(and(...conditions))
      .orderBy(pointsOfInterest.createdAt);

    return { success: true, data: rows };
  });

  // POST /api/pois
  app.post<{
    Body: {
      name: string;
      latitude: number;
      longitude: number;
      radiusMeters?: number;
      assignedUserIds?: string[] | null;
    };
  }>('/', async (request, reply) => {
    if (!canManageZones(request.user)) return reply.code(403).send({ success: false, error: 'Dispatcher access required' });

    const { departmentId } = request.user as { departmentId: string };
    const { name, latitude, longitude, radiusMeters = 100, assignedUserIds } = request.body;

    if (!name?.trim()) return reply.code(400).send({ success: false, error: 'name is required' });
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return reply.code(400).send({ success: false, error: 'latitude and longitude are required' });
    }

    const [poi] = await db
      .insert(pointsOfInterest)
      .values({
        departmentId,
        name: name.trim(),
        latitude: String(latitude),
        longitude: String(longitude),
        radiusMeters,
        assignedUserIds: assignedUserIds ?? null,
      })
      .returning();

    broadcast(departmentId, { event: 'poi:updated', timestamp: new Date().toISOString() });

    return { success: true, data: poi };
  });

  // PATCH /api/pois/:id
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      latitude?: number;
      longitude?: number;
      radiusMeters?: number;
      active?: boolean;
      assignedUserIds?: string[] | null;
    };
  }>('/:id', async (request, reply) => {
    if (!canManageZones(request.user)) return reply.code(403).send({ success: false, error: 'Dispatcher access required' });

    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;
    const { name, latitude, longitude, radiusMeters, active, assignedUserIds } = request.body;

    const [existing] = await db
      .select({ id: pointsOfInterest.id, departmentId: pointsOfInterest.departmentId })
      .from(pointsOfInterest)
      .where(eq(pointsOfInterest.id, id))
      .limit(1);

    if (!existing) return reply.code(404).send({ success: false, error: 'POI not found' });
    if (existing.departmentId !== departmentId) return reply.code(403).send({ success: false, error: 'Forbidden' });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (latitude !== undefined) updates.latitude = String(latitude);
    if (longitude !== undefined) updates.longitude = String(longitude);
    if (radiusMeters !== undefined) updates.radiusMeters = radiusMeters;
    if (active !== undefined) updates.active = active;
    // null → clear assignments (all users); array → set specific users
    if (assignedUserIds !== undefined) updates.assignedUserIds = assignedUserIds;

    const [updated] = await db
      .update(pointsOfInterest)
      .set(updates)
      .where(eq(pointsOfInterest.id, id))
      .returning();

    broadcast(departmentId, { event: 'poi:updated', timestamp: new Date().toISOString() });

    return { success: true, data: updated };
  });

  // DELETE /api/pois/:id
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    if (!canManageZones(request.user)) return reply.code(403).send({ success: false, error: 'Dispatcher access required' });

    const { departmentId } = request.user as { departmentId: string };
    const { id } = request.params;

    const [existing] = await db
      .select({ id: pointsOfInterest.id, departmentId: pointsOfInterest.departmentId })
      .from(pointsOfInterest)
      .where(eq(pointsOfInterest.id, id))
      .limit(1);

    if (!existing) return reply.code(404).send({ success: false, error: 'POI not found' });
    if (existing.departmentId !== departmentId) return reply.code(403).send({ success: false, error: 'Forbidden' });

    await db.delete(pointsOfInterest).where(eq(pointsOfInterest.id, id));

    broadcast(departmentId, { event: 'poi:updated', timestamp: new Date().toISOString() });

    return { success: true };
  });
}
