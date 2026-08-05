import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useWsEvent } from '../contexts/WebSocketContext';

export interface DeviceData {
  id: string;
  departmentId: string;
  imei: string;
  name: string;
  model: string | null;
  assignedUserId: string | null;
  assignedGroupId: string | null;
  status: string;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
  createdAt: string;
  assignedUserFirstName: string | null;
  assignedUserLastName: string | null;
  assignedGroupName: string | null;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UseDevicesParams {
  page: number;
  limit: number;
  search: string;
  status: string;
}

export function useDevices({ page, limit, search, status }: UseDevicesParams) {
  const [devices, setDevices] = useState<DeviceData[]>([]);
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
    if (status && status !== 'all') params.set('status', status);

    apiFetch<DeviceData[]>(`/devices?${params}`)
      .then((res: any) => {
        if (cancelled) return;
        setDevices(res.data || []);
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
  }, [page, limit, search, status, trigger]);

  // Real-time: refetch on any device mutation
  useWsEvent('device:created', refetch);
  useWsEvent('device:updated', refetch);
  useWsEvent('device:deleted', refetch);

  return { devices, pagination, loading, error, refetch };
}
