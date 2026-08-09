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
import { useGroups } from '../../hooks/useGroups';
import { GroupRow } from './GroupRow';

interface GroupListViewProps {
  search: string;
  selectedGroupIds: Set<string>;
  selectedUserIds: Set<string>;
  onToggleGroup: (group: { id: string; name: string }) => void;
  onToggleUser: (user: { id: string; name: string }) => void;
  onSelectAllGroups?: (groups: { id: string; name: string }[]) => void;
  onClearGroups?: () => void;
}

export function GroupListView({
  search,
  selectedGroupIds,
  selectedUserIds,
  onToggleGroup,
  onToggleUser,
  onSelectAllGroups,
  onClearGroups,
}: GroupListViewProps) {
  const { groups, loading } = useGroups({ page: 1, limit: 200, search, type: '' });

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (groups.length === 0) {
    return <p className="text-xs text-text-secondary text-center py-6">No groups found.</p>;
  }

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-2 px-2 py-2 bg-bg-sidebar/95 border-b border-border/60 backdrop-blur">
        <button
          onClick={() => onSelectAllGroups?.(groups.map((group) => ({ id: group.id, name: group.name })))}
          className="flex-1 px-2 py-1 rounded bg-accent/15 text-accent text-[11px] font-semibold border border-accent/30 hover:bg-accent/25 transition-colors"
        >
          TX All Groups
        </button>
        <button
          onClick={onClearGroups}
          className="px-2 py-1 rounded bg-bg-primary/70 text-text-secondary text-[11px] font-semibold border border-border hover:text-white transition-colors"
        >
          Clear TX
        </button>
      </div>
      {groups.map((g) => (
        <GroupRow
          key={g.id}
          id={g.id}
          name={g.name}
          type={g.type}
          memberCount={g.memberCount}
          onlineMemberCount={g.onlineMemberCount ?? 0}
          groupSelected={selectedGroupIds.has(g.id)}
          onToggleGroup={onToggleGroup}
          selectedUserIds={selectedUserIds}
          onToggleUser={onToggleUser}
        />
      ))}
    </div>
  );
}
