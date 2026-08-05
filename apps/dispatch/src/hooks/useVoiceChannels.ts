import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useWsEvent } from '../contexts/WebSocketContext';

export interface VoiceChannelData {
  id: string;
  name: string;
  livekitRoom: string;
  displayOrder: number;
  isDefault: boolean;
  createdAt: string;
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

    return () => { cancelled = true; };
  }, [trigger]);

  useWsEvent('voice_channel:created', refetch);
  useWsEvent('voice_channel:updated', refetch);
  useWsEvent('voice_channel:deleted', refetch);

  return { channels, loading, error, refetch };
}
