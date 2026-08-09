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
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../../.env') });

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  api: {
    port: parseInt(optional('API_PORT', '3000'), 10),
    host: optional('API_HOST', '0.0.0.0'),
  },
  db: {
    url: required('DATABASE_URL'),
  },
  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },
  jwt: {
    secret: required('JWT_SECRET'),
    accessExpiry: optional('JWT_ACCESS_EXPIRY', '15m'),
    refreshExpiry: optional('JWT_REFRESH_EXPIRY', '7d'),
  },
  livekit: {
    url: optional('LIVEKIT_URL', ''),
    // Public URL returned to clients in tokens. Falls back to LIVEKIT_URL if not
    // set. Set this to the public address when the server is reached from other
    // networks.
    publicUrl: optional('LIVEKIT_PUBLIC_URL', '') || optional('LIVEKIT_URL', ''),
    apiKey: optional('LIVEKIT_API_KEY', ''),
    apiSecret: optional('LIVEKIT_API_SECRET', ''),
  },
  cors: {
    origin: optional('CORS_ORIGIN', 'http://localhost:5173,http://localhost:5174').split(','),
  },
  martin: {
    url: optional('MARTIN_URL', 'http://localhost:3001'),
  },
  geocoding: {
    photonUrl: optional('GEOCODER_PHOTON_URL', 'https://photon.komoot.io'),
    nominatimUrl: optional('GEOCODER_NOMINATIM_URL', 'https://nominatim.openstreetmap.org'),
    userAgent: optional('GEOCODER_USER_AGENT', 'PushComm-CE/1.0 (dispatch geocoding)'),
    timeoutMs: parseInt(optional('GEOCODER_TIMEOUT_MS', '5000'), 10),
    preferCountryCode: optional('GEOCODER_COUNTRY_CODE', 'us'),
    // minLon,minLat,maxLon,maxLat — bias geocoder results toward your service
    // area. Empty = no bias (worldwide).
    biasBbox: optional('GEOCODER_BIAS_BBOX', ''),
  },
} as const;
