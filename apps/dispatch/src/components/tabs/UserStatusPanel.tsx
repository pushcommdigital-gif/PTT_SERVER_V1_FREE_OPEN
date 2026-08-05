import { Activity, Circle, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useUsers } from '../../hooks/useUsers';

const STATUS_ORDER = ['emergency', 'on_scene', 'busy', 'en_route', 'available', 'break', 'off_duty', 'unavailable', 'unknown'];

function statusRank(state: string) {
  const index = STATUS_ORDER.indexOf(state);
  return index === -1 ? STATUS_ORDER.length : index;
}

function statusColor(color: string | null | undefined) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#94a3b8';
}

function formatStatusAge(iso: string | null | undefined) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function UserStatusPanel() {
  const { users, loading, error } = useUsers({ page: 1, limit: 100, search: '', role: 'all', maxRoleLevel: 40 });
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byStatus = new Map<string, typeof users>();
    for (const user of users) {
      const key = user.status ?? 'unknown';
      byStatus.set(key, [...(byStatus.get(key) ?? []), user]);
    }
    return [...byStatus.entries()]
      .sort(([a], [b]) => statusRank(a) - statusRank(b))
      .map(([state, members]) => {
        const first = members[0];
        return {
          state,
          label: first?.statusLabel ?? 'Unknown',
          color: statusColor(first?.statusColor),
          members: members.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
        };
      });
  }, [users]);

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedStatus(null);
      return;
    }
    if (!selectedStatus || !groups.some((group) => group.state === selectedStatus)) {
      setSelectedStatus(groups[0].state);
    }
  }, [groups, selectedStatus]);

  const activeGroup = groups.find((group) => group.state === selectedStatus) ?? groups[0] ?? null;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-red-300">Unable to load user statuses: {error}</div>;
  }

  return (
    <div className="h-full bg-bg-sidebar flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-accent" />
          <div>
            <h3 className="text-sm font-semibold text-white">Personnel Status</h3>
            <p className="text-[11px] text-text-secondary">Latest field-user status by category</p>
          </div>
          <span className="ml-auto text-[11px] text-text-secondary">{users.length} units</span>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="border-b border-border bg-bg-primary/35 px-3 py-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {groups.map((group) => {
              const active = group.state === activeGroup?.state;
              return (
                <button
                  key={group.state}
                  onClick={() => setSelectedStatus(group.state)}
                  className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-accent bg-accent/20 text-white'
                      : 'border-border bg-bg-sidebar/70 text-text-secondary hover:border-accent/40 hover:text-white'
                  }`}
                  title={`Show ${group.label} users`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="text-[11px] font-semibold whitespace-nowrap">{group.label}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      active ? 'bg-white/15 text-white' : 'bg-white/5 text-text-secondary'
                    }`}>
                      {group.members.length}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {groups.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-text-secondary">
            No field users found.
          </div>
        ) : activeGroup ? (
          <section className="rounded-xl border border-border bg-bg-primary/45 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/70">
                <span
                  className="w-2.5 h-2.5 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.25)]"
                  style={{ backgroundColor: activeGroup.color }}
                />
                <span className="text-xs font-semibold text-white">{activeGroup.label}</span>
                <span className="ml-auto text-[10px] text-text-secondary">
                  {activeGroup.members.length} unit{activeGroup.members.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="divide-y divide-border/40">
                {activeGroup.members.map((user) => (
                  <div key={user.id} className="px-3 py-2 flex items-center gap-2">
                    <Circle
                      size={8}
                      className={user.isOnline ? 'text-success fill-success' : 'text-text-secondary/40 fill-text-secondary/40'}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white truncate">{user.firstName} {user.lastName}</p>
                      <p className="text-[10px] text-text-secondary truncate">
                        @{user.username}{user.groupName ? ` - ${user.groupName}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-text-secondary">{formatStatusAge(user.statusAt)}</p>
                      <p className="text-[9px] uppercase tracking-wide text-text-secondary/60">{user.isOnline ? 'online' : 'offline'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-text-secondary">
            Select a status.
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-[10px] text-text-secondary flex items-center gap-1.5">
        <Users size={11} />
        Updates automatically when a unit changes Profile status.
      </div>
    </div>
  );
}
