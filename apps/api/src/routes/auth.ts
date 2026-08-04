import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { eq, and, or, ilike } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { roles } from '../db/schema/roles.js';
import { devices } from '../db/schema/devices.js';
import { config } from '../config.js';
import { getDeviceRefreshSignOptions } from '../services/app-config.js';
import { ADMIN_LEVEL } from '@pushcomm/shared';
import type { LoginRequest, LoginResponse, RefreshRequest } from '@pushcomm/shared';

const authRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
    },
  },
} as const;

async function getRoleLevel(departmentId: string, roleName: string): Promise<number> {
  const [role] = await db
    .select({ hierarchyLevel: roles.hierarchyLevel })
    .from(roles)
    .where(and(eq(roles.departmentId, departmentId), eq(roles.name, roleName), eq(roles.isDeleted, false)))
    .limit(1);
  const dbLevel = role?.hierarchyLevel ?? 0;
  // Dispatcher role is elevated to admin-equivalent access by policy.
  if (roleName === 'dispatcher' && dbLevel < ADMIN_LEVEL) {
    return ADMIN_LEVEL;
  }
  return dbLevel;
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post<{ Body: LoginRequest }>('/login', authRateLimit, async (request, reply) => {
    const body = request.body as LoginRequest;
    const { email, password } = body;
    const identifier = email?.trim();

    if (!identifier || !password) {
      return reply.code(400).send({ success: false, error: 'Email/username and password are required' });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(and(or(ilike(users.email, identifier), ilike(users.username, identifier)), eq(users.isDeleted, false)))
      .limit(1);

    if (!user) {
      return reply.code(401).send({ success: false, error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return reply.code(403).send({ success: false, error: 'Account is deactivated' });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return reply.code(401).send({ success: false, error: 'Invalid credentials' });
    }

    const roleLevel = await getRoleLevel(user.departmentId, user.role);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      roleLevel,
      departmentId: user.departmentId,
    };

    const accessToken = app.jwt.sign(payload, { expiresIn: config.jwt.accessExpiry });
    const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: config.jwt.refreshExpiry });

    // Update last login
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const response: LoginResponse = {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        departmentId: user.departmentId,
      },
    };

    return reply.send({ success: true, data: response });
  });

  // POST /api/auth/refresh
  app.post<{ Body: RefreshRequest }>('/refresh', authRateLimit, async (request, reply) => {
    const body = request.body as RefreshRequest;
    const { refreshToken } = body;

    if (!refreshToken) {
      return reply.code(400).send({ success: false, error: 'Refresh token is required' });
    }

    try {
      const decoded = app.jwt.verify<{ sub: string; type: string }>(refreshToken);
      if (decoded.type !== 'refresh') {
        return reply.code(401).send({ success: false, error: 'Invalid token type' });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, decoded.sub), eq(users.isDeleted, false), eq(users.isActive, true)))
        .limit(1);

      if (!user) {
        return reply.code(401).send({ success: false, error: 'User not found' });
      }

      const roleLevel = await getRoleLevel(user.departmentId, user.role);

      const payload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        roleLevel,
        departmentId: user.departmentId,
      };

      const newAccessToken = app.jwt.sign(payload, { expiresIn: config.jwt.accessExpiry });
      const newRefreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: config.jwt.refreshExpiry });

      return reply.send({
        success: true,
        data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
      });
    } catch {
      return reply.code(401).send({ success: false, error: 'Invalid or expired refresh token' });
    }
  });

  // POST /api/auth/logout
  app.post('/logout', async (_request, reply) => {
    // With stateless JWT, logout is client-side (discard tokens)
    // For token blacklisting, add Redis-based revocation later
    return reply.send({ success: true, message: 'Logged out' });
  });

  // POST /api/auth/fcm-token — store the device's FCM registration token
  app.post<{ Body: { token: string } }>('/fcm-token', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ success: false, error: 'Unauthorized' });
    }

    const { sub } = request.user as { sub: string };
    const { token } = request.body;

    if (!token?.trim()) {
      return reply.code(400).send({ success: false, error: 'token is required' });
    }

    await db.update(users).set({ fcmToken: token.trim() }).where(eq(users.id, sub));

    return { success: true };
  });

  // DELETE /api/auth/fcm-token — clear FCM token on logout
  app.delete('/fcm-token', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ success: false, error: 'Unauthorized' });
    }

    const { sub } = request.user as { sub: string };
    await db.update(users).set({ fcmToken: null }).where(eq(users.id, sub));

    return { success: true };
  });

  // POST /api/auth/device-login — IMEI + provisioning key → short-lived access + refresh tokens
  // No email/password needed. Credentials are burned into the radio at provisioning time.
  app.post<{ Body: { imei: string; provisioningKey: string } }>('/device-login', authRateLimit, async (request, reply) => {
    const { imei, provisioningKey } = request.body;

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

    await db
      .update(devices)
      .set({ status: 'active', lastSeenAt: new Date(), ipAddress: request.ip, updatedAt: new Date() })
      .where(eq(devices.id, device.id));

    const accessToken = app.jwt.sign(
      { sub: device.id, type: 'device', name: device.name, departmentId: device.departmentId },
      { expiresIn: config.jwt.accessExpiry },
    );
    const refreshToken = app.jwt.sign(
      { sub: device.id, type: 'device-refresh' },
      await getDeviceRefreshSignOptions(),
    );

    return reply.send({
      success: true,
      data: {
        accessToken,
        refreshToken,
        device: { id: device.id, name: device.name, departmentId: device.departmentId },
      },
    });
  });

  // POST /api/auth/device-refresh — exchange a device refresh token for a new token pair
  app.post<{ Body: { refreshToken: string } }>('/device-refresh', authRateLimit, async (request, reply) => {
    const { refreshToken } = request.body;

    if (!refreshToken) {
      return reply.code(400).send({ success: false, error: 'Refresh token is required' });
    }

    try {
      const decoded = app.jwt.verify<{ sub: string; type: string }>(refreshToken);

      if (decoded.type !== 'device-refresh') {
        return reply.code(401).send({ success: false, error: 'Invalid token type' });
      }

      const [device] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.id, decoded.sub), eq(devices.isDeleted, false)))
        .limit(1);

      if (!device || device.status === 'disabled') {
        return reply.code(401).send({ success: false, error: 'Device not found or disabled' });
      }

      await db
        .update(devices)
        .set({ lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(devices.id, device.id));

      const newAccessToken = app.jwt.sign(
        { sub: device.id, type: 'device', name: device.name, departmentId: device.departmentId },
        { expiresIn: config.jwt.accessExpiry },
      );
      const newRefreshToken = app.jwt.sign(
        { sub: device.id, type: 'device-refresh' },
        await getDeviceRefreshSignOptions(),
      );

      return reply.send({
        success: true,
        data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
      });
    } catch {
      return reply.code(401).send({ success: false, error: 'Invalid or expired refresh token' });
    }
  });
}
