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

interface UserData {
  id: string;
  departmentId: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  device: string | null; // legacy free-text column, ignored by the UI
  assignedDevice: { id: string; name: string; status: string } | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  notes: string | null;
  groupId: string | null;
  groupName: string | null;
  role: string;
  talkPriority: number;
  isActive: boolean;
  isOnline?: boolean;
  status: string | null;
  statusLabel: string | null;
  statusColor: string | null;
  statusAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UseUsersParams {
  page: number;
  limit: number;
  search: string;
  role: string;
  status?: string;
}

export function useUsers({ page, limit, search, role, status = 'all' }: UseUsersParams) {
  const [users, setUsers] = useState<UserData[]>([]);
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
    if (role && role !== 'all') params.set('role', role);
    if (status && status !== 'all') params.set('status', status);

    apiFetch<UserData[]>(`/users?${params}`)
      .then((res: any) => {
        if (cancelled) return;
        setUsers(res.data || []);
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
  }, [page, limit, search, role, status, trigger]);

  // Real-time: refetch on any user mutation
  useWsEvent('user:created', refetch);
  useWsEvent('user:updated', refetch);
  useWsEvent('user:deleted', refetch);
  useWsEvent('user:online', refetch);
  useWsEvent('user:offline', refetch);
  useWsEvent('user:status_changed', refetch);
  useWsEvent('custom_state:updated', refetch);

  return { users, pagination, loading, error, refetch };
}
