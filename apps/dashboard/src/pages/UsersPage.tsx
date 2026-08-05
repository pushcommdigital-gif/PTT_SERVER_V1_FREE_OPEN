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
import { useCallback, useState, useEffect, useMemo } from 'react';
import { useUsers } from '../hooks/useUsers';
import { useRoles } from '../hooks/useRoles';
import { useCustomStates } from '../hooks/useCustomStates';
import { useDebounce } from '../hooks/useDebounce';
import { Pagination } from '../components/ui/Pagination';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { UserFormModal } from '../components/users/UserFormModal';
import { Toast } from '../components/ui/Toast';
import { apiFetch } from '../lib/api';
import { UserPlus, Pencil, Trash2, Search, ChevronDown, ChevronUp } from 'lucide-react';

interface UserRow {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  device: string | null; // legacy free-text column, ignored by the form
  assignedDevice: { id: string; name: string; status: string } | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  notes: string | null;
  groupId: string | null;
  groupName: string | null;
  role: string;
  isActive: boolean;
  isOnline?: boolean;
  status: string | null;
  statusLabel: string | null;
  statusColor: string | null;
  statusAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

const DEFAULT_PERSONNEL_STATUSES = [
  { name: 'available', buttonText: 'Available', buttonColor: '#22c55e' },
  { name: 'en_route', buttonText: 'En Route', buttonColor: '#38bdf8' },
  { name: 'on_scene', buttonText: 'On Scene', buttonColor: '#f59e0b' },
  { name: 'busy', buttonText: 'Busy', buttonColor: '#a855f7' },
  { name: 'break', buttonText: 'Break', buttonColor: '#64748b' },
  { name: 'unavailable', buttonText: 'Unavailable', buttonColor: '#ef4444' },
  { name: 'off_duty', buttonText: 'Off Duty', buttonColor: '#64748b' },
  { name: 'emergency', buttonText: 'Emergency', buttonColor: '#dc2626' },
];

function formatStatusAt(statusAt: string | null): string {
  if (!statusAt) return 'No recent status update';
  return `Updated: ${new Date(statusAt).toLocaleString()}`;
}

function statusValue(input: string): string {
  return input.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function initialsFor(user: UserRow): string {
  const first = user.firstName?.trim().charAt(0) || user.username?.trim().charAt(0) || '?';
  const last = user.lastName?.trim().charAt(0) || '';
  return `${first}${last}`.toUpperCase();
}

function displayNameFor(user: UserRow): string {
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.username || user.email || 'Unnamed user';
}

export function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const debouncedSearch = useDebounce(search, 300);
  const { roles } = useRoles();
  const { states: personnelStates } = useCustomStates('personnel');

  // Build dynamic role tabs and color map from fetched roles
  const roleTabs = useMemo(
    () => [
      { label: 'All', value: 'all' },
      ...roles.map((r) => ({ label: r.displayName, value: r.name })),
    ],
    [roles],
  );

  const roleColorMap = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.name, r.color])),
    [roles],
  );

  const roleDisplayMap = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.name, r.displayName])),
    [roles],
  );

  const { users, pagination, loading, refetch } = useUsers({
    page,
    limit: 20,
    search: debouncedSearch,
    role: roleFilter,
    status: statusFilter,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter, statusFilter]);

  const statusTabs = useMemo(
    () => [
      { label: 'All Statuses', value: 'all', color: '#94a3b8' },
      ...(personnelStates.length > 0 ? personnelStates : DEFAULT_PERSONNEL_STATUSES).map((state) => ({
        label: state.buttonText,
        value: statusValue(state.name),
        color: state.buttonColor,
      })),
    ],
    [personnelStates],
  );

  async function handleDelete() {
    if (!deleteUser) return;
    await apiFetch(`/users/${deleteUser.id}`, { method: 'DELETE' });
    setDeleteUser(null);
    refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-text-secondary mt-1">{pagination?.total ?? 0} total users</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus size={18} /> Create User
        </Button>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-2.5 text-text-secondary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="Search users..."
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {roleTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setRoleFilter(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                roleFilter === tab.value
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 flex-wrap rounded-lg border border-border bg-bg-card p-1">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors cursor-pointer ${
              statusFilter === tab.value
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:bg-white/5 hover:text-white'
            }`}
          >
            {tab.value !== 'all' && (
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tab.color }} />
            )}
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg bg-bg-card border border-border p-5 animate-pulse h-44" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <Card>
          <p className="text-text-secondary text-center py-8">No users found</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((u: UserRow) => (
            <Card key={u.id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-sm font-medium text-accent shrink-0">
                    {initialsFor(u)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedUserId((curr) => (curr === u.id ? null : u.id))}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="font-medium truncate">
                      {displayNameFor(u)}
                    </p>
                    <p className="text-xs text-text-secondary truncate">@{u.username}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedUserId((curr) => (curr === u.id ? null : u.id))}
                    className="text-text-secondary hover:text-white transition-colors cursor-pointer"
                    aria-label={expandedUserId === u.id ? 'Collapse user details' : 'Expand user details'}
                  >
                    {expandedUserId === u.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                <p className="text-sm text-text-secondary truncate mb-2">{u.email}</p>
                <p className="text-sm text-text-secondary truncate mb-2">
                  Device: {u.assignedDevice ? u.assignedDevice.name : 'No device assigned'}
                </p>
                <p className="text-sm text-text-secondary truncate mb-2">
                  Phone: {u.phone?.trim() ? u.phone : 'Not provided'}
                </p>

                <div className="flex items-center gap-2 mb-2">
                  <Badge style={roleColorMap[u.role] ? { backgroundColor: roleColorMap[u.role], color: 'white' } : undefined}>
                    {roleDisplayMap[u.role] || u.role.replace('_', ' ')}
                  </Badge>
                  <Badge variant={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
                  <Badge variant={u.isOnline ? 'success' : 'default'}>{u.isOnline ? 'Online' : 'Offline'}</Badge>
                </div>

                <div className="mb-2 flex items-center gap-2">
                  {u.statusLabel ? (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: u.statusColor || '#64748b' }}
                      title={formatStatusAt(u.statusAt)}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
                      {u.statusLabel}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-xs font-medium text-text-secondary">
                      No status
                    </span>
                  )}
                </div>

                <p className="text-xs text-text-secondary">
                  Last active: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                </p>

                {expandedUserId === u.id && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2 text-sm">
                    <p className="text-text-secondary">
                      Address: <span className="text-white">{u.address?.trim() ? u.address : 'Not provided'}</span>
                    </p>
                    <p className="text-text-secondary">
                      City: <span className="text-white">{u.city?.trim() ? u.city : 'Not provided'}</span>
                    </p>
                    <p className="text-text-secondary">
                      State: <span className="text-white">{u.state?.trim() ? u.state : 'Not provided'}</span>
                    </p>
                    <p className="text-text-secondary">
                      Zip Code: <span className="text-white">{u.zipCode?.trim() ? u.zipCode : 'Not provided'}</span>
                    </p>
                    <p className="text-text-secondary">
                      Group: <span className="text-white">{u.groupName?.trim() ? u.groupName : 'Not assigned'}</span>
                    </p>
                    <p className="text-text-secondary whitespace-pre-wrap">
                      Notes: <span className="text-white">{u.notes?.trim() ? u.notes : 'No notes'}</span>
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                <Button variant="ghost" size="sm" onClick={() => setEditUser(u)}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteUser(u)}
                  className="text-danger hover:text-danger"
                >
                  <Trash2 size={14} /> Delete
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

      <UserFormModal
        open={createOpen || !!editUser}
        onClose={() => {
          setCreateOpen(false);
          setEditUser(null);
        }}
        user={editUser}
        onSuccess={(type) => {
          setCreateOpen(false);
          setEditUser(null);
          refetch();
          setToast({
            message: type === 'created' ? 'User created successfully' : 'Changes saved successfully',
            type: 'success',
          });
        }}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={dismissToast}
        />
      )}

      <ConfirmDialog
        open={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        onConfirm={handleDelete}
        title="Delete User"
        message={`Are you sure you want to delete ${deleteUser ? displayNameFor(deleteUser) : 'this user'}? This action cannot be undone.`}
      />
    </div>
  );
}
