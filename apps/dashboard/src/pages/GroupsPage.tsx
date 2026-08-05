import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGroups, type GroupData } from '../hooks/useGroups';
import { useGroupTypes } from '../hooks/useGroupTypes';
import { useDebounce } from '../hooks/useDebounce';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Pagination } from '../components/ui/Pagination';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { GroupFormModal } from '../components/groups/GroupFormModal';
import { GroupMembersModal } from '../components/groups/GroupMembersModal';
import { apiFetch } from '../lib/api';
import { Plus, Users, Pencil, Trash2, Search } from 'lucide-react';

interface GroupsPageProps {
  typeFilter?: string;
}

export function GroupsPage({ typeFilter }: GroupsPageProps = {}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const { groupTypes } = useGroupTypes();

  const typeColorMap = useMemo(
    () => Object.fromEntries(groupTypes.map((gt) => [gt.name, gt.color])),
    [groupTypes],
  );

  const typeDisplayMap = useMemo(
    () => Object.fromEntries(groupTypes.map((gt) => [gt.name, gt.displayName])),
    [groupTypes],
  );

  const label = typeFilter
    ? (typeDisplayMap[typeFilter] || typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1)) + 's'
    : 'Groups';

  const { groups, pagination, loading, refetch } = useGroups({
    page,
    limit: 12,
    search: debouncedSearch,
    type: typeFilter,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<GroupData | null>(null);
  const [membersGroup, setMembersGroup] = useState<GroupData | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<GroupData | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  async function handleDelete() {
    if (!deleteGroup) return;
    await apiFetch(`/groups/${deleteGroup.id}`, { method: 'DELETE' });
    setDeleteGroup(null);
    refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{label}</h1>
          <p className="text-text-secondary mt-1">{pagination?.total ?? 0} total {label.toLowerCase()}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate('/group-types')}>
            <Plus size={18} /> Create New Group Type
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={18} /> Create {typeFilter ? label.slice(0, -1) : 'Group'}
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-2.5 text-text-secondary" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder={`Search ${label.toLowerCase()}...`}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg bg-bg-card border border-border p-5 animate-pulse h-40" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <p className="text-text-secondary text-center py-8">
            {debouncedSearch ? `No ${label.toLowerCase()} match your search` : `No ${label.toLowerCase()} yet. Create your first one!`}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-lg">{group.name}</h3>
                  <Badge style={typeColorMap[group.type] ? { backgroundColor: typeColorMap[group.type], color: 'white' } : undefined}>
                    {typeDisplayMap[group.type] || group.type}
                  </Badge>
                </div>
                {group.description && (
                  <p className="text-sm text-text-secondary mb-3 line-clamp-2">{group.description}</p>
                )}
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Users size={14} />
                  <span>
                    {group.onlineMemberCount ?? 0} online / {group.memberCount} total
                  </span>
                </div>
              </div>
              <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                <Button variant="ghost" size="sm" onClick={() => setMembersGroup(group)}>
                  <Users size={14} /> Members
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditGroup(group)}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteGroup(group)}
                  className="text-danger hover:text-danger"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {pagination && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onPageChange={setPage}
        />
      )}

      <GroupFormModal
        open={createOpen || !!editGroup}
        onClose={() => {
          setCreateOpen(false);
          setEditGroup(null);
        }}
        group={editGroup}
        onSuccess={refetch}
        defaultType={typeFilter}
      />

      <GroupMembersModal
        open={!!membersGroup}
        group={membersGroup}
        onClose={() => setMembersGroup(null)}
        onChanged={refetch}
      />

      <ConfirmDialog
        open={!!deleteGroup}
        onClose={() => setDeleteGroup(null)}
        onConfirm={handleDelete}
        title="Delete Group"
        message={`Are you sure you want to delete "${deleteGroup?.name}"? This action cannot be undone.`}
      />
    </div>
  );
}
