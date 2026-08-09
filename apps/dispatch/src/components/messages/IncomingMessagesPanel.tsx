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
import { useMemo } from 'react';
import { Bell, MessageSquare, Radio, User, Users } from 'lucide-react';
import type { ConversationsData } from '../../hooks/useMessages';
import type { ConversationItemData } from './ConversationItem';

interface IncomingMessagesPanelProps {
  conversations: ConversationsData;
  onOpenConversation: (conversation: ConversationItemData) => void;
}

type IncomingItem = ConversationItemData & {
  unreadCount: number;
};

function timeAgo(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then) || then <= 0) return '';
  const diff = Math.floor((Date.now() - then) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function itemIcon(type: IncomingItem['type']) {
  if (type === 'direct') return <User size={14} />;
  if (type === 'group') return <Users size={14} />;
  return <Radio size={14} />;
}

export function IncomingMessagesPanel({ conversations, onOpenConversation }: IncomingMessagesPanelProps) {
  const items = useMemo<IncomingItem[]>(() => {
    const directItems: IncomingItem[] = conversations.direct
      .filter((conversation) => conversation.unread_count > 0)
      .map((conversation) => ({
        id: conversation.partner_id,
        name: `${conversation.partner_first_name} ${conversation.partner_last_name}`.trim() || 'Unknown unit',
        type: 'direct',
        lastMessage: conversation.last_message,
        lastMessageAt: conversation.last_message_at,
        unreadCount: conversation.unread_count,
      }));

    const groupItems: IncomingItem[] = conversations.group
      .filter((conversation) => conversation.unread_count > 0)
      .map((conversation) => {
        const senderName = `${conversation.sender_first_name ?? ''} ${conversation.sender_last_name ?? ''}`.trim();
        return {
          id: conversation.group_id,
          name: conversation.group_name,
          type: 'group',
          lastMessage: conversation.last_message,
          lastMessageAt: conversation.last_message_at,
          unreadCount: conversation.unread_count,
          lastSenderName: senderName || undefined,
        };
      });

    const broadcastItems: IncomingItem[] = conversations.broadcast
      .filter((message) => !message.is_read)
      .map((message) => ({
        id: message.id,
        name: message.subject || 'Broadcast',
        type: 'broadcast',
        lastMessage: message.last_message,
        lastMessageAt: message.last_message_at,
        unreadCount: 1,
        lastSenderName: `${message.sender_first_name ?? ''} ${message.sender_last_name ?? ''}`.trim() || undefined,
      }));

    return [...directItems, ...groupItems, ...broadcastItems]
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }, [conversations]);

  const totalUnread = items.reduce((sum, item) => sum + item.unreadCount, 0);
  const visibleItems = items.slice(0, 8);

  if (items.length === 0) {
    return (
      <div className="h-full min-h-0 p-4 flex flex-col items-center justify-center text-center bg-bg-primary/20">
        <div className="w-12 h-12 rounded-full border border-border/70 bg-bg-secondary/60 flex items-center justify-center mb-3">
          <MessageSquare size={22} className="text-text-secondary/50" />
        </div>
        <p className="text-sm font-semibold text-white">No unread messages</p>
        <p className="text-xs text-text-secondary/60 mt-1 max-w-[260px]">
          New unit or group messages will stay here until the dispatcher opens them.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-bg-primary/20">
      <div className="px-3 py-2 border-b border-border/80 bg-red-500/10">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Incoming messages</p>
            <p className="text-xs text-red-100/80">
              {totalUnread} unread message{totalUnread === 1 ? '' : 's'} across {items.length} conversation{items.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 slim-scroll">
        {visibleItems.map((item) => (
          <button
            key={`${item.type}-${item.id}`}
            onClick={() => onOpenConversation(item)}
            className="w-full text-left rounded-xl border border-red-400/30 bg-red-500/10 hover:bg-red-500/16 transition-colors p-3 cursor-pointer"
          >
            <div className="flex gap-3">
              <div className="mt-0.5 w-9 h-9 rounded-lg bg-red-500/20 border border-red-300/30 text-red-100 flex items-center justify-center shrink-0">
                {itemIcon(item.type)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{item.name}</p>
                  <span className="ml-auto shrink-0 text-[10px] text-red-100/70">{timeAgo(item.lastMessageAt)}</span>
                </div>
                {item.lastSenderName && (
                  <p className="text-[11px] text-red-100/70 truncate">{item.lastSenderName}</p>
                )}
                <p className="text-xs text-text-secondary/90 truncate mt-1">{item.lastMessage}</p>
              </div>
              <span className="shrink-0 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {item.unreadCount}
              </span>
            </div>
          </button>
        ))}
        {items.length > visibleItems.length && (
          <div className="px-2 py-1 text-[11px] text-text-secondary/60 text-center">
            Showing newest {visibleItems.length} of {items.length} conversations with unread messages.
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border/70 text-[11px] text-text-secondary/60 flex items-center gap-2">
        <Bell size={12} className="text-red-300" />
        Click an item to open a quick reply window.
      </div>
    </div>
  );
}
