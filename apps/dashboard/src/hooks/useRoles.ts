/*
 * PushComm Community Edition
 * Copyright (C) 2026 PushComm Digital
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
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
