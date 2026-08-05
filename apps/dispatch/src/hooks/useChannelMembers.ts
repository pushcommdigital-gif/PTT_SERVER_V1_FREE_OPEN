import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useWsEvent } from '../contexts/WebSocketContext';

interface AssignedGroup {
  groupId: string;
  name: string;
}

interface ExpectedMember {
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  viaDirect: boolean;
  viaGroups: Array<{ groupId: string; groupName: string }>;
}

interface ChannelSummary {
  channel: {
    id: string;
    name: string;
    livekitRoom: string;
  };
  assignedGroups: AssignedGroup[];
  directUsers: Array<{
    userId: string;
    firstName: string;
    lastName: string;
    role: string;
  }>;
  expectedMembers: ExpectedMember[];
}

export function useChannelMembers(channelId: string | null) {
  const [summary, setSummary] = useState<ChannelSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => {
    if (channelId) setTrigger((t) => t + 1);
  }, [channelId]);

  useEffect(() => {
    let cancelled = false;

    if (!channelId) {
      setSummary(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    apiFetch<ChannelSummary>(`/voice-channels/${channelId}/members-summary`)
      .then((res: any) => {
        if (!cancelled) setSummary(res.data || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load channel members');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [channelId, trigger]);

  useWsEvent('voice_channel:updated', refetch);
  useWsEvent('voice_channel:created', refetch);
  useWsEvent('voice_channel:deleted', refetch);
  useWsEvent('group:member_added', refetch);
  useWsEvent('group:member_removed', refetch);
  useWsEvent('user:updated', refetch);

  return { summary, loading, error, refetch };
}

