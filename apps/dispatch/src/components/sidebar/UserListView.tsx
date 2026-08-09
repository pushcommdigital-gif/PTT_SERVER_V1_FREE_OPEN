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
import { useUsers } from '../../hooks/useUsers';
import { CheckSquare, Square, Phone, MapPin } from 'lucide-react';

function safeStatusColor(color: string | null | undefined) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#94a3b8';
}

interface UserListViewProps {
  search: string;
  selectedUserIds: Set<string>;
  onToggleUser: (user: { id: string; name: string }) => void;
  onCall?: (userId: string, name: string) => void;
  activeCallUserId?: string | null;
  trackedIds?: Set<string>;
  onToggleTrack?: (id: string) => void;
  onTrackUsers?: (ids: string[]) => void;
  onUntrackUsers?: (ids: string[]) => void;
}

export function UserListView({
  search,
  selectedUserIds,
  onToggleUser,
  onCall,
  activeCallUserId,
  trackedIds,
  onToggleTrack,
  onTrackUsers,
  onUntrackUsers,
}: UserListViewProps) {
  const { users, loading } = useUsers({ page: 1, limit: 200, search, role: 'all', maxRoleLevel: 40 });

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (users.length === 0) {
    return <p className="text-xs text-text-secondary text-center py-6">No users found.</p>;
  }

  const userIds = users.map((u) => u.id);
  const trackedCount = userIds.filter((id) => trackedIds?.has(id)).length;
  const allTracked = userIds.length > 0 && trackedCount === userIds.length;
  const scopeLabel = search.trim() ? 'results' : 'users';

  return (
    <div>
      {onToggleTrack && (
        <div className="sticky top-0 z-10 border-b border-border/60 bg-bg-sidebar/95 px-3 py-2 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-text-secondary">Map tracking</p>
              <p className="text-[11px] text-white">
                {trackedCount}/{userIds.length} {scopeLabel} tracked
              </p>
            </div>
            <button
              onClick={() => {
                if (allTracked) onUntrackUsers?.(userIds);
                else onTrackUsers?.(userIds);
              }}
              className={`shrink-0 rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                allTracked
                  ? 'border-border text-text-secondary hover:bg-white/10 hover:text-white'
                  : 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
              }`}
              title={allTracked ? `Stop tracking listed ${scopeLabel}` : `Track listed ${scopeLabel} on the map`}
            >
              {allTracked ? 'Clear all' : 'Track all'}
            </button>
          </div>
        </div>
      )}
      {users.map((u) => {
        const name = `${u.firstName} ${u.lastName}`;
        const selected = selectedUserIds.has(u.id);
        const tracked = trackedIds?.has(u.id) ?? false;
        return (
          <div
            key={u.id}
            onClick={() => onToggleUser({ id: u.id, name })}
            className={`flex items-center gap-2 px-3 py-2 transition-colors border-b border-border/40 last:border-0 cursor-pointer ${
              selected ? 'bg-accent/10' : 'hover:bg-white/5'
            }`}
          >
            <span className={`shrink-0 ${selected ? 'text-accent' : 'text-text-secondary/40'}`}>
              {selected ? <CheckSquare size={14} /> : <Square size={14} />}
            </span>
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                u.isOnline ? 'bg-success' : 'bg-text-secondary/40'
              }`}
            />
            <div className="min-w-0 flex-1">
              <span className="block text-xs text-white truncate">{name}</span>
              {u.statusLabel && (
                <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-secondary">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: safeStatusColor(u.statusColor) }}
                  />
                  {u.statusLabel}
                </span>
              )}
            </div>
            <span className="text-[10px] text-text-secondary uppercase shrink-0">{u.role}</span>
            {onToggleTrack && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleTrack(u.id); }}
                className={`p-1 rounded transition-colors cursor-pointer shrink-0 ${
                  tracked
                    ? 'text-accent bg-accent/20'
                    : 'text-text-secondary/50 hover:text-accent hover:bg-accent/10'
                }`}
                title={tracked ? `Stop tracking ${name}` : `Track ${name} on map`}
              >
                <MapPin size={11} />
              </button>
            )}
            {onCall && u.isOnline && (
              <button
                onClick={(e) => { e.stopPropagation(); onCall(u.id, name); }}
                className={`p-1 rounded transition-colors cursor-pointer shrink-0 ${
                  activeCallUserId === u.id
                    ? 'text-accent bg-accent/20'
                    : 'text-text-secondary/50 hover:text-accent hover:bg-accent/10'
                }`}
                title={activeCallUserId === u.id ? `In call with ${name}` : `Private call ${name}`}
              >
                <Phone size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
