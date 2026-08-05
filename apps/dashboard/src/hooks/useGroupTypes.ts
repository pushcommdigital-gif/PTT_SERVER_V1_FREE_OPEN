import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

export interface GroupTypeData {
  id: string;
  departmentId: string;
  name: string;
  displayName: string;
  description: string | null;
  color: string;
  isSystem: boolean;
  createdAt: string;
}

export function useGroupTypes() {
  const [groupTypes, setGroupTypes] = useState<GroupTypeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    apiFetch<GroupTypeData[]>('/group-types')
      .then((res: any) => {
        if (!cancelled) setGroupTypes(res.data || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [trigger]);

  return { groupTypes, loading, refetch };
}
