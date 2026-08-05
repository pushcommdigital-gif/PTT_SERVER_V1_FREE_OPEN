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
import { useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { useGroups } from '../../hooks/useGroups';
import { ConversationItem, type ConversationItemData } from './ConversationItem';
import type { ConversationsData } from '../../hooks/useMessages';

type TabType = 'direct' | 'group';

interface ConversationListProps {
  conversations: ConversationsData;
  loading: boolean;
  selectedId: string | null;
  selectedType: ConversationItemData['type'] | null;
  onSelect: (conv: ConversationItemData) => void;
  search: string;
}

export function ConversationList({
  conversations,
  loading,
  selectedId,
  selectedType,
  onSelect,
  search,
}: ConversationListProps) {
  const [tab, setTab] = useState<TabType>('direct');
  const { user } = useAuth();
  const { users, loading: usersLoading } = useUsers({ page: 1, limit: 200, search: '', role: 'all' });
  const { groups, loading: groupsLoading } = useGroups({ page: 1, limit: 200, search: '' });

  const directConversationItems: ConversationItemData[] = conversations.direct.map((c) => ({
    id: c.partner_id,
    name: `${c.partner_first_name} ${c.partner_last_name}`,
    type: 'direct',
    lastMessage: c.last_message,
    lastMessageAt: c.last_message_at,
    unreadCount: c.unread_count,
  }));

  const groupConversationItems: ConversationItemData[] = conversations.group.map((c) => ({
    id: c.group_id,
    name: c.group_name,
    type: 'group',
    lastMessage: c.last_message,
    lastMessageAt: c.last_message_at,
    unreadCount: c.unread_count,
    lastSenderName: c.sender_first_name ?? undefined,
  }));

  const newestFirst = (a: ConversationItemData, b: ConversationItemData) => {
    const tDiff = new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    return tDiff !== 0 ? tDiff : a.name.localeCompare(b.name);
  };

  const usersTabItems: ConversationItemData[] = users
    .filter((u) => u.id !== user?.id)
    .map((u) => {
      const existing = directConversationItems.find((c) => c.id === u.id);
      return {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        type: 'direct' as const,
        lastMessage: existing?.lastMessage ?? 'Start conversation',
        lastMessageAt: existing?.lastMessageAt ?? new Date(0).toISOString(),
        unreadCount: existing?.unreadCount ?? 0,
        subtitle: `@${u.username}`,
      };
    })
    .sort(newestFirst);

  const groupsTabItems: ConversationItemData[] = groups
    .map((g) => {
      const existing = groupConversationItems.find((c) => c.id === g.id);
      return {
        id: g.id,
        name: g.name,
        type: 'group' as const,
        lastMessage: existing?.lastMessage ?? 'Start group conversation',
        lastMessageAt: existing?.lastMessageAt ?? new Date(0).toISOString(),
        unreadCount: existing?.unreadCount ?? 0,
        subtitle: `${g.memberCount} member${g.memberCount === 1 ? '' : 's'}`,
      };
    })
    .sort(newestFirst);

  const sourceItems = tab === 'direct' ? usersTabItems : groupsTabItems;

  const normalizedSearch = search.trim().toLowerCase();
  const items = useMemo(() => {
    if (!normalizedSearch) return sourceItems;
    return sourceItems.filter((item) => {
      const haystack = `${item.name} ${item.lastMessage} ${item.lastSenderName ?? ''} ${item.subtitle ?? ''}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, sourceItems]);

  const listLoading = loading || usersLoading || groupsLoading;
  const tabs: { value: TabType; label: string; count: number }[] = [
    { value: 'direct', label: 'Users', count: usersTabItems.length },
    { value: 'group', label: 'Groups', count: groupsTabItems.length },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex border-b border-border/80 px-2 pt-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex-1 mx-1 py-2 text-xs rounded-md transition-colors cursor-pointer ${
              tab === t.value
                ? 'text-white bg-accent/90'
                : 'text-text-secondary/70 hover:text-text-secondary hover:bg-white/5'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1 text-[10px] ${tab === t.value ? 'opacity-90' : 'opacity-60'}`}>({t.count})</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0 slim-scroll">
        {listLoading ? (
          <div className="flex justify-center py-4">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-center text-xs text-text-secondary/50 py-6">
            No items found
          </p>
        ) : (
          items.map((item) => (
            <ConversationItem
              key={`${item.type}-${item.id}`}
              conversation={item}
              selected={selectedId === item.id && selectedType === item.type}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
