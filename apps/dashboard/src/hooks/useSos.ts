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

export interface SosEntry {
  id: string;
  status: string;
  latitude: string | null;
  longitude: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  reportedById: string;
  firstName: string;
  lastName: string;
  ackFirstName: string | null;
  ackLastName: string | null;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UseSosParams {
  page: number;
  limit: number;
  search: string;
  from: string;
  to: string;
  acknowledgedBy: string;
}

export function useSos({ page, limit, search, from, to, acknowledgedBy }: UseSosParams) {
  const [entries, setEntries] = useState<SosEntry[]>([]);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      all: 'true',
    });
    if (search) params.set('search', search);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (acknowledgedBy) params.set('acknowledgedBy', acknowledgedBy);

    apiFetch<SosEntry[]>(`/sos?${params}`)
      .then((res: any) => {
        if (cancelled) return;
        setEntries(res.data || []);
        setPagination(res.pagination || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, limit, search, from, to, acknowledgedBy, trigger]);

  useWsEvent('sos:triggered', refetch);
  useWsEvent('sos:acknowledged', refetch);

  return { entries, pagination, loading, error, refetch };
}
