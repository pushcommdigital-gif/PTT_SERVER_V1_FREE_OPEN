import { useState } from 'react';
import { Radio, Search, X } from 'lucide-react';
import { GroupListView } from './GroupListView';
import { UserListView } from './UserListView';

type SidebarView = 'groups' | 'users';

export interface TalkTarget {
  id: string;
  name: string;
}

interface SidebarPanelProps {
  broadcast: boolean;
  onToggleBroadcast: () => void;
  selectedGroupIds: Set<string>;
  selectedGroups: TalkTarget[];
  selectedUserIds: Set<string>;
  selectedUsers: TalkTarget[];
  onToggleGroup: (group: TalkTarget) => void;
  onSelectAllGroups?: (groups: TalkTarget[]) => void;
  onClearGroups?: () => void;
  onToggleUser: (user: TalkTarget) => void;
  onClearSelection: () => void;
  onCallUser?: (userId: string, name: string) => void;
  activeCallUserId?: string | null;
  trackedIds?: Set<string>;
  onToggleTrack?: (id: string) => void;
  onTrackUsers?: (ids: string[]) => void;
  onUntrackUsers?: (ids: string[]) => void;
}

export function SidebarPanel({
  broadcast,
  onToggleBroadcast,
  selectedGroupIds,
  selectedGroups,
  selectedUserIds,
  selectedUsers,
  onToggleGroup,
  onSelectAllGroups,
  onClearGroups,
  onToggleUser,
  onClearSelection,
  onCallUser,
  activeCallUserId,
  trackedIds,
  onToggleTrack,
  onTrackUsers,
  onUntrackUsers,
}: SidebarPanelProps) {
  const [view, setView] = useState<SidebarView>('groups');
  const [search, setSearch] = useState('');

  const totalSelected = selectedGroups.length + selectedUsers.length;

  return (
    <div className="flex flex-col h-full bg-bg-sidebar">
      {/* Broadcast toggle */}
      <div className="px-3 py-1.5 border-b border-border shrink-0">
        <button
          onClick={onToggleBroadcast}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
            broadcast
              ? 'bg-red-500/20 text-red-300 border border-red-500/30'
              : 'bg-bg-primary/60 text-text-secondary border border-border hover:text-white'
          }`}
        >
          <Radio size={13} className={broadcast ? 'text-red-400 animate-pulse' : ''} />
          <span>Broadcast All</span>
          {broadcast && <span className="ml-auto text-[10px] uppercase">Active</span>}
        </button>
      </div>

      {/* Toggle buttons: Group list / User */}
      <div className="flex border-b border-border shrink-0">
        <button
          onClick={() => { setView('groups'); setSearch(''); }}
          className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
            view === 'groups'
              ? 'text-white bg-accent/20 border-b-2 border-accent'
              : 'text-text-secondary hover:text-white'
          }`}
        >
          Group list
        </button>
        <button
          onClick={() => { setView('users'); setSearch(''); }}
          className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
            view === 'users'
              ? 'text-white bg-accent/20 border-b-2 border-accent'
              : 'text-text-secondary hover:text-white'
          }`}
        >
          User
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-2 text-text-secondary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-bg-primary border border-border rounded pl-7 pr-2 py-1.5 text-xs text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder={view === 'groups' ? 'Search groups...' : 'Search users...'}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === 'groups' ? (
          <GroupListView
            search={search}
            selectedGroupIds={selectedGroupIds}
            selectedUserIds={selectedUserIds}
            onToggleGroup={onToggleGroup}
            onToggleUser={onToggleUser}
            onSelectAllGroups={onSelectAllGroups}
            onClearGroups={onClearGroups}
          />
        ) : (
          <UserListView
            search={search}
            selectedUserIds={selectedUserIds}
            onToggleUser={onToggleUser}
            onCall={onCallUser}
            activeCallUserId={activeCallUserId}
            trackedIds={trackedIds}
            onToggleTrack={onToggleTrack}
            onTrackUsers={onTrackUsers}
            onUntrackUsers={onUntrackUsers}
          />
        )}
      </div>

      {/* Selection summary bar */}
      {(totalSelected > 0 || broadcast) && (
        <div className="px-3 py-2 border-t border-border shrink-0 bg-bg-primary/60">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-text-secondary min-w-0">
              {broadcast ? (
                <span className="text-red-300 font-semibold">Broadcasting to all</span>
              ) : (
                <>
                  {selectedGroups.length > 0 && (
                    <span className="text-accent">
                      {selectedGroups.length} group{selectedGroups.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {selectedGroups.length > 0 && selectedUsers.length > 0 && (
                    <span className="text-text-secondary"> + </span>
                  )}
                  {selectedUsers.length > 0 && (
                    <span className="text-accent">
                      {selectedUsers.length} user{selectedUsers.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="text-text-secondary"> selected</span>
                </>
              )}
            </div>
            <button
              onClick={onClearSelection}
              className="shrink-0 p-1 rounded text-text-secondary hover:text-white hover:bg-white/10 cursor-pointer"
              title="Clear selection"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
