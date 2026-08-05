import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

export interface PttClip {
  id: string;
  speakerUserId: string | null;
  speakerLabel: string | null;
  speakerFirstName: string | null;
  speakerLastName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  fileSize: number | null;
  status: string;
  filePath: string | null;
  isDispatch: boolean;
  locationLat: string | null;
  locationLon: string | null;
}

export interface PttSession {
  id: string;
  roomName: string;
  channelId: string | null;
  channelName: string | null;
  isPrivate: boolean;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  maxParticipantCount: number;
  status: string;
  locationLat: string | null;
  locationLon: string | null;
  clipCount: number;
  clips?: PttClip[];
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UseCdrParams {
  page: number;
  limit: number;
  channelId: string;
  from: string;
  to: string;
}

export function useCdr({ page, limit, channelId, from, to }: UseCdrParams) {
  const [sessions, setSessions] = useState<PttSession[]>([]);
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
    if (channelId) params.set('channelId', channelId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    apiFetch<PttSession[]>(`/ptt-sessions?${params}`)
      .then((res: any) => {
        if (cancelled) return;
        setSessions(res.data || []);
        setPagination(res.pagination || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [page, limit, channelId, from, to, trigger]);

  return { sessions, pagination, loading, error, refetch };
}
