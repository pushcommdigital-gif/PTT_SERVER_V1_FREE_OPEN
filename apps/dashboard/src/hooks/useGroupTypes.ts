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
