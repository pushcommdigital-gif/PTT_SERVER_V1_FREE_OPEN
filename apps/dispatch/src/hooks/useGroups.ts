import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useWsEvent } from '../contexts/WebSocketContext';

export interface GroupData {
  id: string;
  departmentId: string;
  parentGroupId: string | null;
  name: string;
  type: string;
  description: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  onlineMemberCount?: number;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UseGroupsParams {
  page: number;
  limit: number;
  search: string;
  type?: string;
}

export function useGroups({ page, limit, search, type }: UseGroupsParams) {
  const [groups, setGroups] = useState<GroupData[]>([]);
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
    if (type) params.set('type', type);

    apiFetch<GroupData[]>(`/groups?${params}`)
      .then((res: any) => {
        if (cancelled) return;
        setGroups(res.data || []);
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
  }, [page, limit, search, type, trigger]);

  // Real-time: refetch on any group mutation
  useWsEvent('group:created', refetch);
  useWsEvent('group:updated', refetch);
  useWsEvent('group:deleted', refetch);
  useWsEvent('group:member_added', refetch);
  useWsEvent('group:member_removed', refetch);
  useWsEvent('user:presence', refetch);

  return { groups, pagination, loading, error, refetch };
}
