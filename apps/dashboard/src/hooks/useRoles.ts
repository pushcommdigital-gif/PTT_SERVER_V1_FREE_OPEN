import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

export interface RoleData {
  id: string;
  departmentId: string;
  name: string;
  displayName: string;
  description: string | null;
  hierarchyLevel: number;
  color: string;
  isSystem: boolean;
  userCount: number;
  users: string[];
  createdAt: string;
}

function dedupeRolesByName(roles: RoleData[]) {
  const seen = new Set<string>();
  return roles.filter((role) => {
    if (seen.has(role.name)) return false;
    seen.add(role.name);
    return true;
  });
}

export function useRoles() {
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<RoleData[]>('/roles')
      .then((res: any) => {
        if (cancelled) return;
        setRoles(dedupeRolesByName(res.data || []));
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
  }, [trigger]);

  return { roles, loading, error, refetch };
}
