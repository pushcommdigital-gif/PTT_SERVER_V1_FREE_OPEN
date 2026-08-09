/*
 * PushComm Community Edition
 * Copyright (C) 2026 Corbani Mauro
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
import { useWsEvent } from '../contexts/WebSocketContext';

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

  useWsEvent('custom_state:updated', refetch);

  return { states, loading, error, refetch };
}
