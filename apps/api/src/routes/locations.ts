import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, or, gte, lte, inArray, asc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { locations } from '../db/schema/locations.js';
import { geofences } from '../db/schema/geofences.js';
import { pointsOfInterest } from '../db/schema/points-of-interest.js';
import { zoneAlerts } from '../db/schema/zone-alerts.js';
import { users } from '../db/schema/users.js';
import { devices } from '../db/schema/devices.js';
import { broadcast } from '../ws/broadcast.js';
import { redis } from '../redis.js';
import { sendFcm } from '../services/fcm.js';

/** Ray-casting point-in-polygon. coords are [lon, lat] pairs (GeoJSON convention). */
function pointInPolygon(lat: number, lon: number, coords: [number, number][]): boolean {
  let inside = false;
  const n = coords.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = coords[i][0], yi = coords[i][1];
    const xj = coords[j][0], yj = coords[j][1];
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

/** Haversine distance in metres between two lat/lon points. */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function locationRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // POST /api/locations — Android devices push their GPS position
  app.post<{
    Body: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      speed?: number;
      heading?: number;
      altitude?: number;
    };
  }>('/', async (request, reply) => {
    const { sub, departmentId, type } = request.user as { sub: string; departmentId: string; type?: string };
    const { latitude, longitude, accuracy, speed, heading, altitude } = request.body;

    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return reply.code(400).send({ success: false, error: 'latitude and longitude are required' });
    }

    const isDevice = type === 'device';
    let locationUserId = sub;

    if (isDevice) {
      const [device] = await db
        .select({ assignedUserId: devices.assignedUserId })
        .from(devices)
        .where(and(eq(devices.id, sub), eq(devices.departmentId, departmentId), eq(devices.isDeleted, false)))
        .limit(1);

      if (!device?.assignedUserId) {
        return reply.code(400).send({ success: false, error: 'Device is not assigned to a user' });
      }

      locationUserId = device.assignedUserId;
    }

    await db.insert(locations).values({
      userId: locationUserId,
      latitude: String(latitude),
      longitude: String(longitude),
      accuracy: accuracy != null ? String(accuracy) : null,
      speed: speed != null ? String(speed) : null,
      heading: heading != null ? String(heading) : null,
      altitude: altitude != null ? String(altitude) : null,
    }).onConflictDoNothing();

    broadcast(departmentId, {
      event: 'location:update',
      userId: locationUserId,
      latitude,
      longitude,
      speed: speed ?? null,
      heading: heading ?? null,
      timestamp: new Date().toISOString(),
    });

    // Geofence + POI enter/exit detection (fire-and-forget)
    checkGeofences(locationUserId, departmentId, latitude, longitude).catch(() => {});
    checkPois(locationUserId, departmentId, latitude, longitude).catch(() => {});

    return { success: true };
  });

  // POST /api/locations/batch — store-and-forward flush of buffered fixes. Each fix carries
  // its OWN recorded timestamp (historical/backfilled after a signal drop), so we insert the
  // timestamp explicitly. All fixes are inserted for the gap-free track; only the NEWEST drives
  // the live map + geofence checks (we don't replay historical positions/alerts). When online the
  // device drains ~1 fix at a time, so this is also the normal near-real-time path.
  app.post<{
    Body: {
      fixes?: Array<{
        latitude: number; longitude: number;
        accuracy?: number; speed?: number; heading?: number; altitude?: number;
        timestamp: string | number;
      }>;
    };
  }>('/batch', async (request, reply) => {
    const { sub, departmentId, type } = request.user as { sub: string; departmentId: string; type?: string };
    const fixes = request.body?.fixes;
    if (!Array.isArray(fixes) || fixes.length === 0) {
      return reply.code(400).send({ success: false, error: 'fixes[] required' });
    }
    if (fixes.length > 1000) {
      return reply.code(413).send({ success: false, error: 'Too many fixes (max 1000 per request)' });
    }

    // Resolve the location user (device → assigned user), same as the single POST.
    const isDevice = type === 'device';
    let locationUserId = sub;
    if (isDevice) {
      const [device] = await db
        .select({ assignedUserId: devices.assignedUserId })
        .from(devices)
        .where(and(eq(devices.id, sub), eq(devices.departmentId, departmentId), eq(devices.isDeleted, false)))
        .limit(1);
      if (!device?.assignedUserId) {
        return reply.code(400).send({ success: false, error: 'Device is not assigned to a user' });
      }
      locationUserId = device.assignedUserId;
    }

    const rows: Array<typeof locations.$inferInsert> = [];
    const seenTs = new Set<number>();
    for (const f of fixes) {
      if (typeof f.latitude !== 'number' || typeof f.longitude !== 'number' || !Number.isFinite(f.latitude) || !Number.isFinite(f.longitude)) continue;
      const ts = new Date(f.timestamp);
      if (isNaN(ts.getTime())) continue;
      // Drop in-batch duplicates (same user+timestamp) — Postgres ON CONFLICT can't dedupe
      // rows within a single INSERT, and duplicate producers land dupes in the same flush.
      if (seenTs.has(ts.getTime())) continue;
      seenTs.add(ts.getTime());
      rows.push({
        userId: locationUserId,
        latitude: String(f.latitude),
        longitude: String(f.longitude),
        accuracy: f.accuracy != null ? String(f.accuracy) : null,
        speed: f.speed != null ? String(f.speed) : null,
        heading: f.heading != null ? String(f.heading) : null,
        altitude: f.altitude != null ? String(f.altitude) : null,
        timestamp: ts,
      });
    }
    if (rows.length === 0) return reply.code(400).send({ success: false, error: 'No valid fixes' });

    // Ignore fixes already stored for this user+timestamp (cross-batch dupes / retries).
    await db.insert(locations).values(rows).onConflictDoNothing();

    // Live map + alerts reflect only the newest fix (don't replay history).
    const newest = rows.reduce((a, b) => ((b.timestamp as Date) > (a.timestamp as Date) ? b : a));
    const lat = Number(newest.latitude), lon = Number(newest.longitude);
    broadcast(departmentId, {
      event: 'location:update',
      userId: locationUserId,
      latitude: lat,
      longitude: lon,
      speed: newest.speed != null ? Number(newest.speed) : null,
      heading: newest.heading != null ? Number(newest.heading) : null,
      timestamp: new Date().toISOString(),
    });
    checkGeofences(locationUserId, departmentId, lat, lon).catch(() => {});
    checkPois(locationUserId, departmentId, lat, lon).catch(() => {});

    return { success: true, data: { inserted: rows.length } };
  });

  // GET /api/locations/track — GPS fix history for one or more users in a time window
  app.get<{
    Querystring: { 'userId[]'?: string | string[]; from?: string; to?: string; limit?: string };
  }>('/track', async (request, reply) => {
    const { departmentId } = request.user as { departmentId: string };
    const { from, to } = request.query;
    const limitRaw = parseInt(request.query.limit ?? '2000', 10);
    const limit = Math.min(isNaN(limitRaw) ? 2000 : limitRaw, 5000);

    const rawIds = request.query['userId[]'];
    const userIds = rawIds ? (Array.isArray(rawIds) ? rawIds : [rawIds]) : [];
    if (userIds.length === 0) return reply.code(400).send({ success: false, error: 'userId[] required' });

    const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    // Verify all requested users belong to this department
    const deptUsers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username })
      .from(users)
      .where(and(eq(users.departmentId, departmentId), inArray(users.id, userIds)));

    const userMap = Object.fromEntries(deptUsers.map((u) => [u.id, u]));

    // Track Replay (CE) returns the RAW fixes only. Snap-to-road map matching is
    // part of the private Telematics add-on and is deliberately not here.

    const tracks = await Promise.all(
      deptUsers.map(async (u) => {
        const pts = await db
          .select({
            lat: locations.latitude,
            lon: locations.longitude,
            altitude: locations.altitude,
            speed: locations.speed,
            heading: locations.heading,
            accuracy: locations.accuracy,
            ts: locations.timestamp,
          })
          .from(locations)
          .where(and(
            eq(locations.userId, u.id),
            gte(locations.timestamp, fromDate),
            lte(locations.timestamp, toDate),
          ))
          .orderBy(asc(locations.timestamp))
          .limit(limit);

        const points = pts.map((p) => ({
          lat: parseFloat(p.lat as unknown as string),
          lon: parseFloat(p.lon as unknown as string),
          ts: (p.ts as Date).toISOString(),
          speed: p.speed != null ? parseFloat(p.speed as unknown as string) : null,
          heading: p.heading != null ? parseFloat(p.heading as unknown as string) : null,
          accuracy: p.accuracy != null ? parseFloat(p.accuracy as unknown as string) : null,
        }));

        return {
          userId: u.id,
          displayName: `${u.firstName} ${u.lastName}`.trim() || u.username,
          callsign: u.username,
          points,
        };
      })
    );

    return reply.send({ success: true, data: { tracks, from: fromDate.toISOString(), to: toDate.toISOString() } });
  });
}

async function getUser(userId: string) {
  const [user] = await db
    .select({ firstName: users.firstName, lastName: users.lastName, fcmToken: users.fcmToken })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user;
}

async function checkGeofences(
  userId: string,
  departmentId: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  const activeFences = await db
    .select()
    .from(geofences)
    .where(and(
      eq(geofences.departmentId, departmentId),
      eq(geofences.active, true),
      // NULL = monitor all users; array = only those users
      or(isNull(geofences.assignedUserIds), sql`${geofences.assignedUserIds} @> ARRAY[${userId}]::uuid[]`),
    ));

  if (activeFences.length === 0) return;

  const insideNow = new Set(
    activeFences
      .filter((f) => pointInPolygon(latitude, longitude, f.coordinates as [number, number][]))
      .map((f) => f.id),
  );

  const stateKey = `geofence:inside:${departmentId}:${userId}`;
  const prevRaw = await redis.get(stateKey);
  const insidePrev = new Set<string>(prevRaw ? (JSON.parse(prevRaw) as string[]) : []);
  await redis.set(stateKey, JSON.stringify([...insideNow]), 'EX', 7200);

  const enters = activeFences.filter((f) => !insidePrev.has(f.id) && insideNow.has(f.id));
  const exits = activeFences.filter((f) => insidePrev.has(f.id) && !insideNow.has(f.id));
  if (enters.length === 0 && exits.length === 0) return;

  const user = await getUser(userId);
  const now = new Date().toISOString();

  for (const fence of enters) {
    await db.insert(zoneAlerts).values({
      departmentId,
      zoneType: 'geofence',
      zoneId: fence.id,
      zoneName: fence.name,
      userId,
      alertType: 'enter',
      latitude: String(latitude),
      longitude: String(longitude),
    });
    broadcast(departmentId, {
      event: 'geofence:alert',
      geofenceId: fence.id,
      geofenceName: fence.name,
      userId,
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      type: 'enter',
      latitude,
      longitude,
      timestamp: now,
    });
    if (user?.fcmToken) {
      sendFcm([user.fcmToken], { type: 'geofence', geofenceId: fence.id, geofenceName: fence.name, alertType: 'enter' });
    }
  }

  for (const fence of exits) {
    await db.insert(zoneAlerts).values({
      departmentId,
      zoneType: 'geofence',
      zoneId: fence.id,
      zoneName: fence.name,
      userId,
      alertType: 'exit',
      latitude: String(latitude),
      longitude: String(longitude),
    });
    broadcast(departmentId, {
      event: 'geofence:alert',
      geofenceId: fence.id,
      geofenceName: fence.name,
      userId,
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      type: 'exit',
      latitude,
      longitude,
      timestamp: now,
    });
    if (user?.fcmToken) {
      sendFcm([user.fcmToken], { type: 'geofence', geofenceId: fence.id, geofenceName: fence.name, alertType: 'exit' });
    }
  }
}

async function checkPois(
  userId: string,
  departmentId: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  const activePois = await db
    .select()
    .from(pointsOfInterest)
    .where(and(
      eq(pointsOfInterest.departmentId, departmentId),
      eq(pointsOfInterest.active, true),
      // NULL = monitor all users; array = only those users
      or(isNull(pointsOfInterest.assignedUserIds), sql`${pointsOfInterest.assignedUserIds} @> ARRAY[${userId}]::uuid[]`),
    ));

  if (activePois.length === 0) return;

  const insideNow = new Set(
    activePois
      .filter((p) =>
        haversineMeters(
          latitude,
          longitude,
          parseFloat(p.latitude),
          parseFloat(p.longitude),
        ) <= p.radiusMeters,
      )
      .map((p) => p.id),
  );

  const stateKey = `poi:inside:${departmentId}:${userId}`;
  const prevRaw = await redis.get(stateKey);
  const insidePrev = new Set<string>(prevRaw ? (JSON.parse(prevRaw) as string[]) : []);
  await redis.set(stateKey, JSON.stringify([...insideNow]), 'EX', 7200);

  const enters = activePois.filter((p) => !insidePrev.has(p.id) && insideNow.has(p.id));
  const exits = activePois.filter((p) => insidePrev.has(p.id) && !insideNow.has(p.id));
  if (enters.length === 0 && exits.length === 0) return;

  const user = await getUser(userId);
  const now = new Date().toISOString();

  for (const poi of enters) {
    await db.insert(zoneAlerts).values({
      departmentId,
      zoneType: 'poi',
      zoneId: poi.id,
      zoneName: poi.name,
      userId,
      alertType: 'enter',
      latitude: String(latitude),
      longitude: String(longitude),
    });
    broadcast(departmentId, {
      event: 'poi:alert',
      poiId: poi.id,
      poiName: poi.name,
      userId,
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      type: 'enter',
      latitude,
      longitude,
      timestamp: now,
    });
    if (user?.fcmToken) {
      sendFcm([user.fcmToken], { type: 'poi', poiId: poi.id, poiName: poi.name, alertType: 'enter' });
    }
  }

  for (const poi of exits) {
    await db.insert(zoneAlerts).values({
      departmentId,
      zoneType: 'poi',
      zoneId: poi.id,
      zoneName: poi.name,
      userId,
      alertType: 'exit',
      latitude: String(latitude),
      longitude: String(longitude),
    });
    broadcast(departmentId, {
      event: 'poi:alert',
      poiId: poi.id,
      poiName: poi.name,
      userId,
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      type: 'exit',
      latitude,
      longitude,
      timestamp: now,
    });
    if (user?.fcmToken) {
      sendFcm([user.fcmToken], { type: 'poi', poiId: poi.id, poiName: poi.name, alertType: 'exit' });
    }
  }
}
