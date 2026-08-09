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
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useWsEvent } from '../contexts/WebSocketContext';

export interface ZoneAlertEntry {
  id: string;
  zoneType: 'geofence' | 'poi';
  zoneId: string;
  zoneName: string;
  alertType: 'enter' | 'exit';
  latitude: string | null;
  longitude: string | null;
  triggeredAt: string;
  userId: string;
  firstName: string;
  lastName: string;
  username: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UseZoneAlertsParams {
  page: number;
  limit: number;
  search: string;
  zoneType: string;
  alertType: string;
  from: string;
  to: string;
}

export function useZoneAlerts({ page, limit, search, zoneType, alertType, from, to }: UseZoneAlertsParams) {
  const [entries, setEntries] = useState<ZoneAlertEntry[]>([]);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    if (zoneType) params.set('zoneType', zoneType);
    if (alertType) params.set('alertType', alertType);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    apiFetch<ZoneAlertEntry[]>(`/zone-alerts?${params}`)
      .then((res: any) => {
        if (cancelled) return;
        setEntries(res.data || []);
        setPagination(res.pagination || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [page, limit, search, zoneType, alertType, from, to, trigger]);

  useWsEvent('geofence:alert', refetch);
  useWsEvent('poi:alert', refetch);

  return { entries, pagination, loading, error, refetch };
}
