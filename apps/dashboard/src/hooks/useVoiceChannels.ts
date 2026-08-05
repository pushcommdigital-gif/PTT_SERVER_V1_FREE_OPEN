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
import { useWsEvent } from '../contexts/WebSocketContext';

export interface VoiceChannelData {
  id: string;
  name: string;
  livekitRoom: string;
  displayOrder: number;
  isDefault: boolean;
  assignedGroupCount: number;
  assignedUserCount: number;
  createdAt: string;
  updatedAt: string;
}

export function useVoiceChannels() {
  const [channels, setChannels] = useState<VoiceChannelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<VoiceChannelData[]>('/voice-channels')
      .then((res: any) => {
        if (!cancelled) setChannels(res.data || []);
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

  useWsEvent('voice_channel:created', refetch);
  useWsEvent('voice_channel:updated', refetch);
  useWsEvent('voice_channel:deleted', refetch);

  return { channels, loading, error, refetch };
}

