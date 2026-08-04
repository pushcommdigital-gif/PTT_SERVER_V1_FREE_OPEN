import type { FastifyInstance } from 'fastify';
import { eq, and, asc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { customStates } from '../db/schema/custom-states.js';
import { CUSTOM_STATE_TYPES, ADMIN_LEVEL } from '@pushcomm/shared';
import { broadcast } from '../ws/broadcast.js';

export async function customStateRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/custom-states?type=personnel|unit|staffing
  app.get<{
    Querystring: { type?: string };
  }>('/', async (request) => {
    const { departmentId } = request.user as { departmentId: string };
    const typeFilter = request.query.type;

    const conditions: any[] = [
      eq(customStates.departmentId, departmentId),
      eq(customStates.isDeleted, false),
    ];

    if (typeFilter && CUSTOM_STATE_TYPES.includes(typeFilter as any)) {
      conditions.push(eq(customStates.type, typeFilter));
    }

    const result = await db
      .select()
      .from(customStates)
      .where(and(...conditions))
      .orderBy(asc(customStates.type), asc(customStates.displayOrder));

    return { success: true, data: result };
  });

  // POST /api/custom-states
  app.post<{
    Body: {
      type: string;
      name: string;
      buttonText: string;
      buttonColor: string;
      displayOrder?: number;
    };
  }>('/', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { type, name, buttonText, buttonColor, displayOrder } = request.body;

    if (!type || !name || !buttonText || !buttonColor) {
      return reply.code(400).send({ success: false, error: 'Missing required fields' });
    }

    if (!CUSTOM_STATE_TYPES.includes(type as any)) {
      return reply.code(400).send({ success: false, error: 'Invalid type' });
    }

    // Auto-set displayOrder if not provided
    let order = displayOrder ?? 0;
    if (!displayOrder) {
      const [maxOrder] = await db
        .select({ max: sql<number>`coalesce(max(${customStates.displayOrder}), 0)::int` })
        .from(customStates)
        .where(and(eq(customStates.departmentId, departmentId), eq(customStates.type, type), eq(customStates.isDeleted, false)));
      order = (maxOrder?.max ?? 0) + 1;
    }

    const [created] = await db
      .insert(customStates)
      .values({ departmentId, type, name, buttonText, buttonColor, displayOrder: order })
      .returning();

    broadcast(departmentId, { event: 'custom_state:updated', type, stateId: created.id, timestamp: new Date().toISOString() });

    return reply.code(201).send({ success: true, data: created });
  });

  // PATCH /api/custom-states/:id
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      buttonText?: string;
      buttonColor?: string;
      displayOrder?: number;
    };
  }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;
    const { name, buttonText, buttonColor, displayOrder } = request.body;

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (buttonText !== undefined) updates.buttonText = buttonText;
    if (buttonColor !== undefined) updates.buttonColor = buttonColor;
    if (displayOrder !== undefined) updates.displayOrder = displayOrder;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ success: false, error: 'No fields to update' });
    }

    const [updated] = await db
      .update(customStates)
      .set(updates)
      .where(and(eq(customStates.id, id), eq(customStates.departmentId, departmentId), eq(customStates.isDeleted, false)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Custom state not found' });
    }

    broadcast(departmentId, { event: 'custom_state:updated', type: updated.type, stateId: updated.id, timestamp: new Date().toISOString() });

    return { success: true, data: updated };
  });

  // DELETE /api/custom-states/:id
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel: number; departmentId: string };

    if (roleLevel < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }

    const { id } = request.params;

    const [deleted] = await db
      .update(customStates)
      .set({ isDeleted: true })
      .where(and(eq(customStates.id, id), eq(customStates.departmentId, departmentId), eq(customStates.isDeleted, false)))
      .returning({ id: customStates.id });

    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'Custom state not found' });
    }

    broadcast(departmentId, { event: 'custom_state:updated', stateId: id, timestamp: new Date().toISOString() });

    return { success: true, message: 'Custom state deleted' };
  });
}
