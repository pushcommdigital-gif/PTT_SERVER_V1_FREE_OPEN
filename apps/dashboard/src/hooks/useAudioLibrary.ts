import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

export interface AudioData {
  id: string;
  filename: string;
  fileSize: number | null;
  duration: string | null;
  mimeType: string | null;
  category: string;
  createdAt: string;
  uploaderFirstName: string | null;
  uploaderLastName: string | null;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UseAudioLibraryParams {
  page: number;
  limit: number;
  search: string;
  category: string;
}

export function useAudioLibrary({ page, limit, search, category }: UseAudioLibraryParams) {
  const [audioFiles, setAudioFiles] = useState<AudioData[]>([]);
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
    if (category && category !== 'all') params.set('category', category);

    apiFetch<AudioData[]>(`/audio-library?${params}`)
      .then((res: any) => {
        if (cancelled) return;
        setAudioFiles(res.data || []);
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
  }, [page, limit, search, category, trigger]);

  return { audioFiles, pagination, loading, error, refetch };
}
