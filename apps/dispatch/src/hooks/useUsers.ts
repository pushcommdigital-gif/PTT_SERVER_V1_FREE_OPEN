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
  phone: string | null;
  role: string;
  isActive: boolean;
  isOnline?: boolean;
  groupId?: string | null;
  groupName?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  statusColor?: string | null;
  statusAt?: string | null;
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
  maxRoleLevel?: number;
}

export function useUsers({ page, limit, search, role, maxRoleLevel }: UseUsersParams) {
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
    if (maxRoleLevel !== undefined) params.set('maxRoleLevel', String(maxRoleLevel));

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
  }, [page, limit, search, role, maxRoleLevel, trigger]);

  // Real-time: refetch on any user mutation
  useWsEvent('user:created', refetch);
  useWsEvent('user:updated', refetch);
  useWsEvent('user:deleted', refetch);
  useWsEvent('user:presence', refetch);
  useWsEvent('user:status_changed', refetch);

  return { users, pagination, loading, error, refetch };
}
