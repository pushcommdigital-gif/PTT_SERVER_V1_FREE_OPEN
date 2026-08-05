/*
 * PushComm Community Edition
 * Copyright (C) 2026 PushComm Digital
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useWsEvent } from '../contexts/WebSocketContext';

export interface MapDriverPoint {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  groupId: string | null;
  groupName: string | null;
  latitude: number;
  longitude: number;
  lastLocationAt: string | null;
  status: string | null;
  statusLabel: string | null;
  statusColor: string | null;
  statusAt: string | null;
}

interface MapOverviewData {
  drivers: MapDriverPoint[];
  boundsHint: {
    region: string;
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

export function useMapOverview() {
  const [data, setData] = useState<MapOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<MapOverviewData>('/map/overview')
      .then((res) => {
        if (!cancelled) setData(res.data || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load map overview');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  useWsEvent('location:update', () => setTick((t) => t + 1));
  useWsEvent('user:status_changed', () => setTick((t) => t + 1));
  useWsEvent('user:updated', () => setTick((t) => t + 1));
  useWsEvent('user:created', () => setTick((t) => t + 1));
  // Refetch on presence changes so offline units drop off the map immediately
  // instead of lingering up to 15s until the next polling tick. The map API
  // already filters to online users only — we just need to ask it sooner.
  useWsEvent('user:presence', () => setTick((t) => t + 1));

  return { data, loading, error, refetch: () => setTick((t) => t + 1) };
}
