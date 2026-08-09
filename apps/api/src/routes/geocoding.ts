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
import type { FastifyInstance } from 'fastify';
import { autocompleteAddress, forwardGeocode, reverseGeocode } from '../services/geocoding.js';

export async function geocodingRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // GET /api/geocoding/autocomplete?q=...&limit=...
  app.get<{ Querystring: { q?: string; limit?: string } }>('/autocomplete', async (request, reply) => {
    const q = request.query.q?.trim() || '';
    if (!q) {
      return reply.code(400).send({ success: false, error: 'q is required' });
    }
    const limit = Math.min(20, Math.max(1, parseInt(request.query.limit || '8', 10)));
    const data = await autocompleteAddress(q, limit);
    return { success: true, data };
  });

  // GET /api/geocoding/forward?q=...&limit=...
  app.get<{ Querystring: { q?: string; limit?: string } }>('/forward', async (request, reply) => {
    const q = request.query.q?.trim() || '';
    if (!q) {
      return reply.code(400).send({ success: false, error: 'q is required' });
    }
    const limit = Math.min(20, Math.max(1, parseInt(request.query.limit || '5', 10)));
    const data = await forwardGeocode(q, limit);
    return { success: true, data };
  });

  // GET /api/geocoding/reverse?lat=...&lng=...
  app.get<{ Querystring: { lat?: string; lng?: string; lon?: string } }>('/reverse', async (request, reply) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng ?? request.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply.code(400).send({ success: false, error: 'lat and lng are required' });
    }
    const item = await reverseGeocode(lat, lng);
    return { success: true, data: item ? [item] : [] };
  });
}

