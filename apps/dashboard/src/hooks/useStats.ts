import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useWsEvent } from '../contexts/WebSocketContext';

interface OverviewStats {
  totalUsers: number;
  activeUsers: number;
  totalGroups: number;
  totalDevices: number;
  activeDevices: number;
  pendingDevices: number;
  totalPttSessions: number;
  activePttSessions: number;
  totalCalls?: number;
  activeCalls?: number;
  totalUnits?: number;
  onlineUsers: number;
}

export function useStats() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiFetch<OverviewStats>('/stats/overview')
      .then((res) => {
        if (!cancelled) setStats(res.data || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [trigger]);

  useEffect(() => {
    const timer = window.setInterval(refetch, 30_000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  // Real-time: refetch stats when entities are created/deleted/closed
  useWsEvent('user:created', refetch);
  useWsEvent('user:deleted', refetch);
  useWsEvent('group:created', refetch);
  useWsEvent('group:deleted', refetch);
  useWsEvent('device:created', refetch);
  useWsEvent('device:updated', refetch);
  useWsEvent('device:deleted', refetch);
  useWsEvent('user:presence', refetch);

  return { stats, loading, error, refetch };
}
