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
import { useCallback, useEffect, useState } from 'react';
import { CheckSquare, ChevronDown, ChevronRight, Square, Users } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { MemberRow } from './MemberRow';

interface GroupMember {
  id: string;
  userId: string;
  isAdmin: boolean;
  firstName: string;
  lastName: string;
  role: string;
  isOnline?: boolean;
}

interface GroupRowProps {
  id: string;
  name: string;
  type: string;
  memberCount: number;
  onlineMemberCount: number;
  /** Is this whole group selected? */
  groupSelected?: boolean;
  /** Toggle entire group selection */
  onToggleGroup?: (group: { id: string; name: string }) => void;
  /** Set of individually selected user IDs */
  selectedUserIds?: Set<string>;
  /** Toggle individual user */
  onToggleUser?: (user: { id: string; name: string }) => void;
}

export function GroupRow({
  id,
  name,
  memberCount,
  onlineMemberCount,
  groupSelected,
  onToggleGroup,
  selectedUserIds,
  onToggleUser,
}: GroupRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  useEffect(() => {
    if (!expanded || members.length > 0) return;
    setLoadingMembers(true);
    apiFetch<any>(`/groups/${id}`)
      .then((res) => setMembers(res.data?.members || []))
      .catch(() => setMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [expanded, id, members.length]);

  // Count selected members in this group
  const selectedMemberCount = members.filter((m) => selectedUserIds?.has(m.userId)).length;
  const hasPartialSelection = !groupSelected && selectedMemberCount > 0;

  return (
    <div className="border-b border-border/40 last:border-0">
      <div className="flex items-center gap-1 px-2 py-2 hover:bg-white/5 transition-colors">
        {/* Group checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleGroup?.({ id, name }); }}
          className={`shrink-0 p-0.5 cursor-pointer ${
            groupSelected ? 'text-accent' : hasPartialSelection ? 'text-accent/50' : 'text-text-secondary/40'
          }`}
          title={groupSelected ? 'Deselect group' : 'Select entire group'}
        >
          {groupSelected ? <CheckSquare size={14} /> : <Square size={14} />}
        </button>

        {/* Expand/collapse + name */}
        <button
          onClick={toggle}
          className="flex-1 flex items-center gap-1.5 min-w-0 cursor-pointer"
        >
          {expanded ? (
            <ChevronDown size={13} className="text-text-secondary shrink-0" />
          ) : (
            <ChevronRight size={13} className="text-text-secondary shrink-0" />
          )}
          <Users size={13} className="text-accent shrink-0" />
          <span className="text-xs font-medium text-white truncate">{name}</span>
        </button>

        {/* Online count + status dot */}
        <span className="text-[10px] text-text-secondary shrink-0">
          {onlineMemberCount}/{memberCount}
        </span>
        <span className={`w-2 h-2 rounded-full shrink-0 ${onlineMemberCount > 0 ? 'bg-success' : 'bg-text-secondary/40'}`} />
      </div>

      {expanded && (
        <div className="pl-4 pb-1">
          {loadingMembers ? (
            <div className="flex justify-center py-2">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-[11px] text-text-secondary px-3 py-1">No members.</p>
          ) : (
            members.map((m) => (
              <MemberRow
                key={m.id}
                userId={m.userId}
                name={`${m.firstName} ${m.lastName}`}
                role={m.role}
                isOnline={m.isOnline}
                isAdmin={m.isAdmin}
                selected={groupSelected || selectedUserIds?.has(m.userId)}
                onToggle={onToggleUser}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
