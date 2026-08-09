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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, Search } from 'lucide-react';
import { ConversationList } from './ConversationList';
import { MessageThread } from './MessageThread';
import { useConversations } from '../../hooks/useMessages';
import { apiFetch } from '../../lib/api';
import type { ConversationItemData } from './ConversationItem';

interface MessagesPanelProps {
  initialConversation?: ConversationItemData | null;
}

export function MessagesPanel({ initialConversation }: MessagesPanelProps = {}) {
  const { conversations, loading, refetch } = useConversations();
  const [selectedConversation, setSelectedConversation] = useState<ConversationItemData | null>(null);
  const [search, setSearch] = useState('');

  const handleSelect = useCallback((conv: ConversationItemData) => {
    setSelectedConversation(conv);
    // Mark all messages in this conversation as read, then refresh the list
    apiFetch('/messages/mark-read', {
      method: 'PATCH',
      body: JSON.stringify({
        type: conv.type,
        targetUserId: conv.type === 'direct' ? conv.id : undefined,
        targetGroupId: conv.type === 'group' ? conv.id : undefined,
      }),
    }).then(() => refetch()).catch(() => {/* silent */});
  }, [refetch]);

  useEffect(() => {
    if (!initialConversation) return;
    handleSelect(initialConversation);
  }, [initialConversation, handleSelect]);

  const totalUnread = useMemo(() => {
    const directUnread = conversations.direct.reduce((acc, c) => acc + (c.unread_count || 0), 0);
    const groupUnread = conversations.group.reduce((acc, c) => acc + (c.unread_count || 0), 0);
    const broadcastUnread = conversations.broadcast.reduce((acc, c) => acc + (c.is_read ? 0 : 1), 0);
    return directUnread + groupUnread + broadcastUnread;
  }, [conversations]);

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[360px] shrink-0 border-r border-border bg-bg-primary/40 flex flex-col min-h-0">
        <div className="px-4 pt-3 pb-2 border-b border-border/80">
          <div className="mb-3">
            <h3 className="text-lg font-semibold text-white">Messages</h3>
            <p className="text-xs text-text-secondary">
              {totalUnread > 0 ? `${totalUnread} unread` : 'All caught up'}
            </p>
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users or groups..."
              className="w-full pl-8 pr-2 py-2 rounded-lg border border-border bg-bg-secondary/70 text-sm text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        <ConversationList
          conversations={conversations}
          loading={loading}
          selectedId={selectedConversation?.id ?? null}
          selectedType={selectedConversation?.type ?? null}
          onSelect={handleSelect}
          search={search}
        />
      </div>

      <div className="flex-1 min-w-0 bg-bg-primary/10">
        {selectedConversation ? (
          <MessageThread conversation={selectedConversation} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <MessageSquare size={28} className="text-text-secondary/30 mb-3" />
            <p className="text-sm text-text-secondary/70 mb-1">
              Select a user or group to start messaging
            </p>
            <p className="text-xs text-text-secondary/40">
              No popup required. Use the left panel tabs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
