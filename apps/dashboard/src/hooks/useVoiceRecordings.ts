import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

export interface VoiceRecording {
  id: string;
  channelId: string | null;
  channelName: string | null;
  direction: string;
  // v2 fields (group | private_call | all_call | sos) — preferred over `direction`
  targetType: string | null;
  targetUserId: string | null;
  targetLabel: string | null;
  deviceId: string | null;
  isSos: boolean;
  endedReason: string | null;
  captureError: string | null;
  status: string;
  speakerLabel: string | null;
  speakerFirstName: string | null;
  speakerLastName: string | null;
  speakerUsername: string | null;
  filePath: string | null;
  fileSize: number | null;
  durationSec: number | null;
  mimeType: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UseVoiceRecordingsParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  channelId?: string;
}

export function useVoiceRecordings({ page, limit, search, status, channelId }: UseVoiceRecordingsParams) {
  const [recordings, setRecordings] = useState<VoiceRecording[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search?.trim()) params.set('search', search.trim());
      if (status && status !== 'all') params.set('status', status);
      if (channelId) params.set('channelId', channelId);
      const res = await apiFetch<VoiceRecording[]>(`/voice-recordings?${params}`);
      setRecordings(res.data ?? []);
      if (res.pagination) setPagination(res.pagination as unknown as Pagination);
    } catch {
      setError('Failed to load recordings');
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, status, channelId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { recordings, pagination, loading, error, refetch: fetch };
}
