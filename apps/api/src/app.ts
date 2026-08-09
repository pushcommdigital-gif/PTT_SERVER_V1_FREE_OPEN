/*
 * PushComm Community Edition
 * Copyright (C) 2026 Corbani Mauro
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fjwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { redis, redisSub } from './redis.js';
import { registerWsRoute } from './ws/ws-manager.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { groupRoutes } from './routes/groups.js';
import { statsRoutes } from './routes/stats.js';
import { customStateRoutes } from './routes/custom-states.js';
import { userStateRoutes } from './routes/user-states.js';
import { callRoutes } from './routes/calls.js';
import { unitRoutes } from './routes/units.js';
import { audioLibraryRoutes } from './routes/audio-library.js';
import { roleRoutes } from './routes/roles.js';
import { groupTypeRoutes } from './routes/group-types.js';
import { deviceRoutes } from './routes/devices.js';
import { messageRoutes } from './routes/messages.js';
import { broadcastRoutes } from './routes/broadcast.js';
import { privateCallRoutes } from './routes/private-calls.js';
import { voiceChannelRoutes } from './routes/voice-channels.js';
import { voiceRecordingRoutes } from './routes/voice-recordings.js';
import { geocodingRoutes } from './routes/geocoding.js';
import { mapRoutes } from './routes/map.js';
import { locationRoutes } from './routes/locations.js';
import { sosRoutes } from './routes/sos.js';
import { livekitWebhookRoutes } from './routes/livekit-webhook.js';
import { pttSessionRoutes } from './routes/ptt-sessions.js';
import { geofenceRoutes } from './routes/geofences.js';
import { poiRoutes } from './routes/pois.js';
import { zoneAlertRoutes } from './routes/zone-alerts.js';
import { settingsRoutes } from './routes/settings.js';
import { setupRoutes } from './routes/setup.js';
import { db } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { pttSessions } from './db/schema/ptt-sessions.js';
import { sql } from 'drizzle-orm';
import { startStuckRecordingReconciler, stopStuckRecordingReconciler } from './services/livekit-egress.js';
import { voiceFloorRoutes } from './routes/voice-floor.js';
import { startFloorBackgroundLoops, stopFloorBackgroundLoops } from './services/floor-control.js';
import { clearCoreEventListeners } from './lib/events.js';
import type { BuildAppOptions } from './lib/registrar.js';

/**
 * Build the Fastify app.
 *
 * `options.registrars` is the API EXTENSION POINT. Community
 * Edition calls this with none — see `index.ts`. The commercial build passes
 * registrars from its private `addons/` workspace, which is the ONLY way paid
 * features attach. Nothing in this repository implements `Registrar`, and the
 * core never imports add-on code.
 */
export async function buildApp(options: BuildAppOptions = {}) {
  const registrars = options.registrars ?? [];

  const app = Fastify({
    trustProxy: true,
    logger: {
      level: config.env === 'production' ? 'info' : 'debug',
      transport:
        config.env === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // --- Plugins ---
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.cors.origin, credentials: true });
  await app.register(rateLimit, { global: false });
  await app.register(fjwt, { secret: config.jwt.secret });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(websocket);

  // --- Auth decorator ---
  app.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // --- Startup: run pending DB migrations before any query (self-hosted
  // installs never migrate manually). Registrars may contribute their own
  // migration directories; the runner applies core + add-on sources together.
  try {
    await runMigrations(
      {
        info: (m: string) => app.log.info(m),
        warn: (m: string) => app.log.warn(m),
        error: (m: string) => app.log.error(m),
      },
      registrars
        .filter((r) => r.migrationsDir)
        .map((r) => ({ name: r.name, dir: r.migrationsDir! })),
    );
  } catch (e) {
    app.log.error(e, '[migrate] migration run failed — aborting startup');
    throw e;
  }

  // --- Startup: close stale PTT sessions (missed webhooks / server restart) ---
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const closed = await db
      .update(pttSessions)
      .set({
        // These never received a room_finished event, so their real duration is
        // unknown — mark incomplete rather than inventing a huge now()-startedAt
        // duration (which produced the bogus 1000m+ values in CDR).
        status: 'incomplete',
        endedAt: new Date(),
        durationSec: null,
      })
      .where(
        // Bind the cutoff as an ISO string: a raw `sql` template parameter must
        // be a primitive. Passing the Date itself makes postgres.js throw
        // ERR_INVALID_ARG_TYPE, so this cleanup silently never ran.
        sql`${pttSessions.status} = 'active' AND ${pttSessions.startedAt} < ${twoHoursAgo.toISOString()}`,
      )
      .returning({ id: pttSessions.id });
    if (closed.length > 0) {
      console.log(`[startup] Closed ${closed.length} stale PTT session(s)`);
    }
  } catch (e) {
    console.warn('[startup] Could not clean stale PTT sessions:', e);
  }

  // --- Redis ---
  await redis.connect();
  await redisSub.connect();

  // --- WebSocket ---
  await registerWsRoute(app);

  // Cleanup Redis on server close
  app.addHook('onClose', async () => {
    await redisSub.quit();
    await redis.quit();
  });

  // --- Core routes ---
  // Webhook must be registered before other routes (no JWT, uses own body parser)
  await app.register(livekitWebhookRoutes, { prefix: '/api' });
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(setupRoutes, { prefix: '/api/setup' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(groupRoutes, { prefix: '/api/groups' });
  await app.register(statsRoutes, { prefix: '/api/stats' });
  await app.register(customStateRoutes, { prefix: '/api/custom-states' });
  await app.register(userStateRoutes, { prefix: '/api/user-states' });
  await app.register(callRoutes, { prefix: '/api/calls' });
  await app.register(unitRoutes, { prefix: '/api/units' });
  await app.register(audioLibraryRoutes, { prefix: '/api/audio-library' });
  await app.register(roleRoutes, { prefix: '/api/roles' });
  await app.register(groupTypeRoutes, { prefix: '/api/group-types' });
  await app.register(deviceRoutes, { prefix: '/api/devices' });
  await app.register(messageRoutes, { prefix: '/api/messages' });
  await app.register(broadcastRoutes, { prefix: '/api/broadcast' });
  await app.register(privateCallRoutes, { prefix: '/api/private-calls' });
  await app.register(voiceChannelRoutes, { prefix: '/api/voice-channels' });
  await app.register(voiceRecordingRoutes, { prefix: '/api/voice-recordings' });
  await app.register(geocodingRoutes, { prefix: '/api/geocoding' });
  await app.register(mapRoutes, { prefix: '/api/map' });
  await app.register(locationRoutes, { prefix: '/api/locations' });
  await app.register(sosRoutes, { prefix: '/api/sos' });
  await app.register(pttSessionRoutes, { prefix: '/api/ptt-sessions' });
  await app.register(geofenceRoutes, { prefix: '/api/geofences' });
  await app.register(poiRoutes, { prefix: '/api/pois' });
  await app.register(zoneAlertRoutes, { prefix: '/api/zone-alerts' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  // Server-side floor authority (half-duplex PTT arbitration).
  await app.register(voiceFloorRoutes, { prefix: '/api/voice/floor' });

  // --- Add-on routes (EXTENSION POINT) ---
  // Registered after core routes so an add-on can never shadow a core path.
  for (const registrar of registrars) {
    if (!registrar.registerRoutes) continue;
    await registrar.registerRoutes(app);
    app.log.info(`[registrar] ${registrar.name}: routes registered`);
  }

  // --- Core background workers ---
  const workerLogger = {
    info: (m: string) => app.log.info(m),
    warn: (m: string) => app.log.warn(m),
    error: (m: string) => app.log.error(m),
  };
  // Reconcile recordings stuck in `status='recording'` because the LiveKit
  // egress_ended webhook never arrived. See services/livekit-egress.ts.
  startStuckRecordingReconciler(workerLogger);
  startFloorBackgroundLoops(workerLogger);

  // --- Add-on workers (EXTENSION POINT) ---
  for (const registrar of registrars) {
    if (!registrar.startWorkers) continue;
    registrar.startWorkers({ log: workerLogger });
    app.log.info(`[registrar] ${registrar.name}: workers started`);
  }

  app.addHook('onClose', async () => {
    stopStuckRecordingReconciler();
    stopFloorBackgroundLoops();
    for (const registrar of registrars) {
      registrar.stopWorkers?.();
    }
    clearCoreEventListeners();
  });

  return app;
}
