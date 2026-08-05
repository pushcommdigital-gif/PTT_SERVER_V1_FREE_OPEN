import { useMemo, useState } from 'react';
import { useRoles, type RoleData } from '../hooks/useRoles';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { RoleFormModal } from '../components/roles/RoleFormModal';
import { apiFetch } from '../lib/api';
import { ShieldPlus, Pencil, Trash2, Lock, ChevronDown, ChevronUp, Users } from 'lucide-react';

export function RolesPage() {
  const { roles, loading, refetch } = useRoles();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleData | null>(null);
  const [deleteRole, setDeleteRole] = useState<RoleData | null>(null);
  const [error, setError] = useState('');
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);

  const orderedRoles = useMemo(() => {
    const fallback = roles.find((r) => r.name === 'not_assigned');
    const rest = roles.filter((r) => r.name !== 'not_assigned');
    return fallback ? [fallback, ...rest] : roles;
  }, [roles]);

  async function handleDelete() {
    if (!deleteRole) return;
    setError('');
    try {
      await apiFetch(`/roles/${deleteRole.id}`, { method: 'DELETE' });
      setDeleteRole(null);
      refetch();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete role');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles</h1>
          <p className="text-text-secondary mt-1">Manage department roles and permission levels</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <ShieldPlus size={18} /> Create Role
        </Button>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderedRoles.map((role) => (
            <Card key={role.id}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg"
                    style={{ backgroundColor: role.color }}
                  >
                    {role.hierarchyLevel}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedRoleId((curr) => (curr === role.id ? null : role.id))}
                        className="font-semibold hover:text-accent transition-colors cursor-pointer"
                      >
                        {role.displayName}
                      </button>
                      {role.isSystem && (
                        <span title="System role"><Lock size={14} className="text-text-secondary" /></span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary">{role.name}</p>
                  </div>
                </div>
                {!role.isSystem && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditRole(role)}
                      className="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-white cursor-pointer"
                      title="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => setDeleteRole(role)}
                      className="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-danger cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
                {role.isSystem && (
                  <button
                    onClick={() => setEditRole(role)}
                    className="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-white cursor-pointer"
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </div>
                {role.description && (
                  <p className="text-sm text-text-secondary mt-2">{role.description}</p>
                )}
              <div className="flex items-center gap-2 mt-2 text-sm text-text-secondary">
                <Users size={14} />
                <span>{role.userCount ?? 0} users</span>
                <button
                  type="button"
                  onClick={() => setExpandedRoleId((curr) => (curr === role.id ? null : role.id))}
                  className="ml-auto text-text-secondary hover:text-white transition-colors cursor-pointer"
                  aria-label={expandedRoleId === role.id ? 'Collapse role users' : 'Expand role users'}
                >
                  {expandedRoleId === role.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
              {expandedRoleId === role.id && (
                <div className="mt-2 pt-2 border-t border-border space-y-1 max-h-32 overflow-y-auto">
                  {(role.users || []).length === 0 ? (
                    <p className="text-xs text-text-secondary">No users assigned</p>
                  ) : (
                    role.users.map((u, idx) => (
                      <p key={`${role.id}-${idx}`} className="text-sm text-text-secondary">
                        {u}
                      </p>
                    ))
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <Badge style={{ backgroundColor: role.color, color: 'white' }}>
                  Level {role.hierarchyLevel}
                </Badge>
                {role.name === 'not_assigned' && (
                  <span className="text-xs text-text-secondary">Default fallback role</span>
                )}
                {role.hierarchyLevel >= 80 && (
                  <span className="text-xs text-text-secondary">Admin access</span>
                )}
                {role.hierarchyLevel >= 40 && role.hierarchyLevel < 80 && (
                  <span className="text-xs text-text-secondary">Dispatcher access</span>
                )}
                {role.hierarchyLevel < 40 && (
                  <span className="text-xs text-text-secondary">Basic access</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <RoleFormModal
        open={createOpen || !!editRole}
        onClose={() => {
          setCreateOpen(false);
          setEditRole(null);
        }}
        role={editRole}
        onSuccess={refetch}
      />

      <ConfirmDialog
        open={!!deleteRole}
        onClose={() => setDeleteRole(null)}
        onConfirm={handleDelete}
        title="Delete Role"
        message={`Are you sure you want to delete the "${deleteRole?.displayName}" role? Users with this role will be switched to "Not Assigned" role.`}
      />
    </div>
  );
}
