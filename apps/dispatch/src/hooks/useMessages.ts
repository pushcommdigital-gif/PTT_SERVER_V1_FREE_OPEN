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
import type {
  BroadcastMessage,
  ConversationsData,
  DirectConversation,
  GroupConversation,
} from '@pushcomm/shared';

export interface MessageData {
  id: string;
  senderId: string;
  type: string;
  targetUserId: string | null;
  targetGroupId: string | null;
  subject: string | null;
  body: string;
  isRead: boolean;
  createdAt: string;
  senderFirstName: string | null;
  senderLastName: string | null;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UseMessagesParams {
  page: number;
  limit: number;
  type?: string;
  targetUserId?: string;
  targetGroupId?: string;
}

export function useMessages({ page, limit, type, targetUserId, targetGroupId }: UseMessagesParams) {
  const [messages, setMessages] = useState<MessageData[]>([]);
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
    if (type) params.set('type', type);
    if (targetUserId) params.set('targetUserId', targetUserId);
    if (targetGroupId) params.set('targetGroupId', targetGroupId);

    const url = `/messages?${params}`;
    apiFetch<MessageData[]>(url)
      .then((res: any) => {
        if (cancelled) return;
        console.log('[useMessages] fetched', url, '→', res.data?.length ?? 0, 'messages');
        setMessages(res.data || []);
        setPagination(res.pagination || null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[useMessages] error', url, err);
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, limit, type, targetUserId, targetGroupId, trigger]);

  // Real-time: refetch on message events
  useWsEvent('message:created', refetch);
  useWsEvent('message:read', refetch);

  return { messages, pagination, loading, error, refetch };
}

export type { BroadcastMessage, ConversationsData, DirectConversation, GroupConversation };

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationsData>({ direct: [], group: [], broadcast: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<ConversationsData>('/messages/conversations')
      .then((res: any) => {
        if (cancelled) return;
        setConversations(res.data || { direct: [], group: [], broadcast: [] });
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

  // Real-time: refetch on message events
  useWsEvent('message:created', refetch);
  useWsEvent('message:read', refetch);

  return { conversations, loading, error, refetch };
}
