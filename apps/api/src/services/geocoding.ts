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
import { config } from '../config.js';

export interface GeocodeResult {
  label: string;
  address: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  source: 'photon' | 'nominatim';
}

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    country?: string;
    road?: string;
    house_number?: string;
  };
}

interface PhotonFeature {
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
  geometry?: {
    coordinates?: [number, number];
  };
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

const geocodeCache = new Map<string, { expiresAt: number; value: unknown }>();
let nominatimQueue: Promise<void> = Promise.resolve();
let nextNominatimAt = 0;

function parseBiasBbox() {
  const parts = config.geocoding.biasBbox
    .split(',')
    .map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon >= maxLon || minLat >= maxLat) return null;
  return { minLon, minLat, maxLon, maxLat };
}

const biasBbox = parseBiasBbox();

function buildAddressLabel(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(', ');
}

function normalizeCommonGeoTypos(query: string) {
  return query
    .replace(/\bsasn\b/gi, 'San')
    .replace(/\bsna\b/gi, 'San')
    .replace(/\bfrancsico\b/gi, 'Francisco')
    .replace(/\bfransisco\b/gi, 'Francisco')
    .replace(/\bfranciso\b/gi, 'Francisco')
    .replace(/\bct\b/gi, 'Court')
    .replace(/\brd\b/gi, 'Road')
    .replace(/\bst\b/gi, 'Street')
    .replace(/\bave\b/gi, 'Avenue');
}

function collapseOneRepeatedLetter(query: string) {
  const parts = query.split(/\b/);
  for (let i = 0; i < parts.length; i += 1) {
    if (!/^[a-z]{5,}$/i.test(parts[i])) continue;
    const collapsed = parts[i].replace(/([a-z])\1/i, '$1');
    if (collapsed !== parts[i]) {
      const next = [...parts];
      next[i] = collapsed;
      return next.join('');
    }
  }
  return query;
}

function buildStreetAddressCandidates(query: string) {
  const seen = new Set<string>([query.trim().toLowerCase()]);
  const candidates: string[] = [];

  function add(candidate: string) {
    const clean = candidate.trim().replace(/\s+/g, ' ');
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    candidates.push(clean);
  }

  const typoNormalized = normalizeCommonGeoTypos(query);
  add(typoNormalized);
  add(collapseOneRepeatedLetter(query));
  add(collapseOneRepeatedLetter(typoNormalized));

  return candidates.slice(0, 4);
}

function preserveInputStreetSpelling(results: GeocodeResult[], inputQuery: string): GeocodeResult[] {
  const input = normalizeCommonGeoTypos(inputQuery);

  // OSM currently returns "Hausman Court" for this South San Francisco street,
  // while property/address sources and user verification show "Haussman Court".
  if (!/\bhaussman\b/i.test(input)) return results;

  return results.map((result) => ({
    ...result,
    label: result.label.replace(/\bHausman\b/g, 'Haussman'),
    address: result.address.replace(/\bHausman\b/g, 'Haussman'),
  }));
}

function isInsideBias(result: GeocodeResult) {
  if (!biasBbox) return false;
  return (
    result.longitude >= biasBbox.minLon &&
    result.longitude <= biasBbox.maxLon &&
    result.latitude >= biasBbox.minLat &&
    result.latitude <= biasBbox.maxLat
  );
}

function preferBiasedResults(results: GeocodeResult[]) {
  if (!biasBbox || results.length <= 1) return results;
  const inside = results.filter(isInsideBias);
  const outside = results.filter((result) => !isInsideBias(result));
  return [...inside, ...outside];
}

function getCached<T>(key: string): T | null {
  const cached = geocodeCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    geocodeCache.delete(key);
    return null;
  }
  return cached.value as T;
}

function setCached<T>(key: string, value: T): T {
  if (geocodeCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = geocodeCache.keys().next().value;
    if (oldestKey) geocodeCache.delete(oldestKey);
  }
  geocodeCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: URL): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.geocoding.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': config.geocoding.userAgent,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNominatimJson<T>(url: URL): Promise<T | null> {
  const work = nominatimQueue.then(async () => {
    const waitMs = Math.max(0, nextNominatimAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    nextNominatimAt = Date.now() + NOMINATIM_MIN_INTERVAL_MS;
    return fetchJson<T>(url);
  });

  nominatimQueue = work.then(() => undefined, () => undefined);
  return work;
}

function mapNominatim(items: NominatimItem[]): GeocodeResult[] {
  return items
    .map((item) => {
      const latitude = Number(item.lat);
      const longitude = Number(item.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const city = item.address?.city || item.address?.town || item.address?.village || null;
      const line1 = buildAddressLabel([item.address?.house_number, item.address?.road]);
      const address = buildAddressLabel([line1 || null, city, item.address?.state, item.address?.postcode, item.address?.country]);
      return {
        label: item.display_name,
        address: address || item.display_name,
        city,
        state: item.address?.state || null,
        zipCode: item.address?.postcode || null,
        country: item.address?.country || null,
        latitude,
        longitude,
        source: 'nominatim' as const,
      };
    })
    .filter((x) => x !== null) as GeocodeResult[];
}

function mapPhoton(features: PhotonFeature[]): GeocodeResult[] {
  return features
    .map((feature) => {
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) return null;
      const longitude = Number(coords[0]);
      const latitude = Number(coords[1]);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const p = feature.properties || {};
      const line1 = buildAddressLabel([p.housenumber, p.street]);
      const address = buildAddressLabel([line1 || p.name || null, p.city, p.state, p.postcode, p.country]);
      return {
        label: address || p.name || 'Unknown location',
        address: address || p.name || 'Unknown location',
        city: p.city || null,
        state: p.state || null,
        zipCode: p.postcode || null,
        country: p.country || null,
        latitude,
        longitude,
        source: 'photon' as const,
      };
    })
    .filter((x) => x !== null) as GeocodeResult[];
}

export async function autocompleteAddress(query: string, limit = 8): Promise<GeocodeResult[]> {
  const clean = query.trim();
  if (!clean) return [];
  const normalizedLimit = Math.min(20, Math.max(1, limit));
  const cacheKey = `autocomplete:${config.geocoding.preferCountryCode}:${normalizedLimit}:${clean.toLowerCase()}`;
  const cached = getCached<GeocodeResult[]>(cacheKey);
  if (cached) return cached;

  // Street addresses are usually more accurate through Nominatim because it
  // supports country scoping; Photon remains better for broad place autocomplete.
  if (/\d/.test(clean)) {
    const nominatimResults = await forwardGeocode(clean, normalizedLimit);
    const localNominatimResults = biasBbox ? nominatimResults.filter(isInsideBias) : nominatimResults;
    if (localNominatimResults.length > 0) return setCached(cacheKey, preserveInputStreetSpelling(localNominatimResults, clean));

    for (const candidate of buildStreetAddressCandidates(clean)) {
      const candidateResults = await forwardGeocode(candidate, normalizedLimit);
      const localCandidateResults = biasBbox ? candidateResults.filter(isInsideBias) : candidateResults;
      if (localCandidateResults.length > 0) {
        return setCached(cacheKey, preserveInputStreetSpelling(localCandidateResults, clean));
      }
    }

    if (nominatimResults.length > 0) return setCached(cacheKey, preserveInputStreetSpelling(nominatimResults, clean));
  }

  const photonUrl = new URL('/api/', config.geocoding.photonUrl);
  photonUrl.searchParams.set('q', clean);
  photonUrl.searchParams.set('limit', String(normalizedLimit));
  if (config.geocoding.preferCountryCode) {
    photonUrl.searchParams.set('lang', 'en');
  }
  const photon = await fetchJson<{ features?: PhotonFeature[] }>(photonUrl);
  const photonResults = preferBiasedResults(preserveInputStreetSpelling(mapPhoton(photon?.features || []), clean));
  if (photonResults.length > 0) return setCached(cacheKey, photonResults);

  return setCached(cacheKey, preferBiasedResults(preserveInputStreetSpelling(await forwardGeocode(clean, normalizedLimit), clean)));
}

export async function forwardGeocode(address: string, limit = 5): Promise<GeocodeResult[]> {
  const clean = address.trim();
  if (!clean) return [];
  const normalizedLimit = Math.min(20, Math.max(1, limit));
  const cacheKey = `forward:${config.geocoding.preferCountryCode}:${normalizedLimit}:${clean.toLowerCase()}`;
  const cached = getCached<GeocodeResult[]>(cacheKey);
  if (cached) return cached;

  const nominatimUrl = new URL('/search', config.geocoding.nominatimUrl);
  nominatimUrl.searchParams.set('q', clean);
  nominatimUrl.searchParams.set('format', 'jsonv2');
  nominatimUrl.searchParams.set('addressdetails', '1');
  nominatimUrl.searchParams.set('limit', String(normalizedLimit));
  nominatimUrl.searchParams.set('countrycodes', config.geocoding.preferCountryCode);

  const results = await fetchNominatimJson<NominatimItem[]>(nominatimUrl);
  return setCached(cacheKey, mapNominatim(results || []));
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const cacheKey = `reverse:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
  const cached = getCached<GeocodeResult | null>(cacheKey);
  if (cached) return cached;

  const nominatimUrl = new URL('/reverse', config.geocoding.nominatimUrl);
  nominatimUrl.searchParams.set('lat', String(latitude));
  nominatimUrl.searchParams.set('lon', String(longitude));
  nominatimUrl.searchParams.set('format', 'jsonv2');
  nominatimUrl.searchParams.set('addressdetails', '1');

  // Photon is only used for forward/place search; reverse geocoding uses Nominatim.
  const result = await fetchNominatimJson<NominatimItem>(nominatimUrl);
  if (!result) return null;
  return setCached(cacheKey, mapNominatim([result])[0] || null);
}
