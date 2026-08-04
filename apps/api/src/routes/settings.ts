import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { departments } from '../db/schema/departments.js';
import { getDeviceSessionTtl, setConfigValue, DEVICE_SESSION_KEY, DEVICE_SESSION_VALUES } from '../services/app-config.js';
import { ADMIN_LEVEL } from '@pushcomm/shared';

// Department-scoped settings. Currently the admin **logout PIN** — the code the
// Android app requires to confirm a manual logout. Stored server-side (in
// departments.settings.logoutPin) so customers can rotate it from the dashboard
// without rebuilding the app, and the app never holds the PIN: it POSTs the
// entered PIN to /verify-pin and the server answers valid/invalid.

const DEFAULT_LOGOUT_PIN = '246813';
const isValidPin = (p: unknown): p is string => typeof p === 'string' && /^\d{4,8}$/.test(p);

async function getLogoutPin(departmentId: string): Promise<string> {
  const [dept] = await db
    .select({ settings: departments.settings })
    .from(departments)
    .where(eq(departments.id, departmentId))
    .limit(1);
  const pin = (dept?.settings as Record<string, unknown> | undefined)?.logoutPin;
  return typeof pin === 'string' && pin.length > 0 ? pin : DEFAULT_LOGOUT_PIN;
}

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // POST /api/settings/verify-pin — any authenticated user (incl. field devices).
  // The app sends the entered PIN; the PIN never leaves the server.
  // Rate-limited so the short numeric PIN can't be brute-forced.
  app.post<{ Body: { pin?: string } }>('/verify-pin', {
    config: { rateLimit: { max: 8, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    if (!departmentId) return reply.code(400).send({ success: false, error: 'No department on token' });
    const pin = (request.body?.pin ?? '').trim();
    const expected = await getLogoutPin(departmentId);
    return reply.send({ success: true, data: { valid: pin.length > 0 && pin === expected } });
  });

  // GET /api/settings/logout-pin — admin: read the current PIN (to show/edit).
  app.get('/logout-pin', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel?: number; departmentId: string };
    if ((roleLevel ?? 0) < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }
    return reply.send({ success: true, data: { pin: await getLogoutPin(departmentId) } });
  });

  // PUT /api/settings/logout-pin { pin } — admin: change the PIN.
  app.put<{ Body: { pin?: string } }>('/logout-pin', async (request, reply) => {
    const { roleLevel, departmentId } = request.user as { roleLevel?: number; departmentId: string };
    if ((roleLevel ?? 0) < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }
    const pin = request.body?.pin?.trim();
    if (!isValidPin(pin)) {
      return reply.code(400).send({ success: false, error: 'PIN must be 4–8 digits' });
    }
    const [dept] = await db
      .select({ settings: departments.settings })
      .from(departments)
      .where(eq(departments.id, departmentId))
      .limit(1);
    const merged = { ...((dept?.settings as Record<string, unknown>) ?? {}), logoutPin: pin };
    await db.update(departments).set({ settings: merged, updatedAt: new Date() }).where(eq(departments.id, departmentId));
    return reply.send({ success: true, data: { pin } });
  });

  // GET /api/settings/device-session — admin: how long a device stays logged in
  // without re-auth (the device refresh-token lifetime; 'never' = no expiry).
  app.get('/device-session', async (request, reply) => {
    const { roleLevel } = request.user as { roleLevel?: number };
    if ((roleLevel ?? 0) < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }
    return reply.send({ success: true, data: { ttl: await getDeviceSessionTtl(), options: DEVICE_SESSION_VALUES } });
  });

  // PUT /api/settings/device-session { ttl } — admin: change it. Applies to new
  // device logins/refreshes; existing sessions roll onto it at their next refresh.
  app.put<{ Body: { ttl?: string } }>('/device-session', async (request, reply) => {
    const { roleLevel } = request.user as { roleLevel?: number };
    if ((roleLevel ?? 0) < ADMIN_LEVEL) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }
    const ttl = request.body?.ttl;
    if (!ttl || !(DEVICE_SESSION_VALUES as readonly string[]).includes(ttl)) {
      return reply.code(400).send({ success: false, error: 'Invalid session length' });
    }
    await setConfigValue(DEVICE_SESSION_KEY, ttl);
    return reply.send({ success: true, data: { ttl } });
  });
}
