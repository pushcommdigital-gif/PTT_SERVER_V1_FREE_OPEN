import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

export interface CustomStateData {
  id: string;
  departmentId: string;
  type: string;
  name: string;
  buttonText: string;
  buttonColor: string;
  displayOrder: number;
  isDeleted: boolean;
  createdAt: string;
}

export function useCustomStates(type: string) {
  const [states, setStates] = useState<CustomStateData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (type && type !== 'all') params.set('type', type);

    apiFetch<CustomStateData[]>(`/custom-states?${params}`)
      .then((res: any) => {
        if (cancelled) return;
        setStates(res.data || []);
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
  }, [type, trigger]);

  return { states, loading, error, refetch };
}
