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
import { useState } from 'react';
import { useDevices, type DeviceData } from '../hooks/useDevices';
import { useDebounce } from '../hooks/useDebounce';
import { DeviceFormModal } from '../components/devices/DeviceFormModal';
import { ProvisioningQrModal } from '../components/devices/ProvisioningQrModal';
import { ConfirmDialog, Badge, Pagination, Button } from '../components/ui';
import { apiFetch } from '../lib/api';
import { Plus, Edit2, Trash2, Smartphone, User, Radio, QrCode, UserMinus, Power } from 'lucide-react';

const statusBadge: Record<string, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
  active: { variant: 'success', label: 'Active' },
  pending: { variant: 'warning', label: 'Pending' },
  disabled: { variant: 'danger', label: 'Disabled' },
};

type QrDevice = Pick<DeviceData, 'id' | 'name' | 'assignedUserId' | 'status'>;

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DevicesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const debouncedSearch = useDebounce(search, 300);

  const { devices, pagination, loading, refetch } = useDevices({
    page,
    limit: 12,
    search: debouncedSearch,
    status: statusFilter,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editDevice, setEditDevice] = useState<DeviceData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeviceData | null>(null);

  const [qrDevice, setQrDevice] = useState<QrDevice | null>(null);

  function handleEdit(device: DeviceData) {
    setEditDevice(device);
    setFormOpen(true);
  }

  function handleCreate() {
    setEditDevice(null);
    setFormOpen(true);
  }

  function handleFormSuccess(createdDevice?: QrDevice | null) {
    refetch();
    if (createdDevice?.assignedUserId) {
      setQrDevice(createdDevice);
    }
  }

  async function handleUnassign(device: DeviceData) {
    try {
      await apiFetch(`/devices/${device.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedUserId: null }),
      });
      refetch();
    } catch {
      // Swallow — the next refetch tick will reveal the real state if it
      // failed. Keeping an explicit toast slot for this is overkill.
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await apiFetch(`/devices/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    refetch();
  }

  // Disable (lock out — token refresh denied within ~15 min) or re-enable a device,
  // without deleting it. Non-destructive alternative to Delete for lost/retired radios.
  async function handleToggleDisabled(device: DeviceData) {
    try {
      await apiFetch(`/devices/${device.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: device.status === 'disabled' ? 'active' : 'disabled' }),
      });
      refetch();
    } catch { /* next refetch reveals real state */ }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Devices</h1>
          <p className="text-text-secondary mt-1">
            {pagination?.total ?? 0} total device{(pagination?.total ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus size={16} className="mr-1.5" />
          Provision Device
        </Button>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search devices..."
          className="w-64 rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white placeholder:text-text-secondary focus:border-accent focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : devices.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-lg p-12 text-center">
          <Smartphone size={48} className="mx-auto text-text-secondary mb-3" />
          <p className="text-text-secondary">No devices found</p>
          <p className="text-text-secondary text-sm mt-1">Click "Provision Device" to add one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.map((device) => {
            const badge = statusBadge[device.status] || statusBadge.pending;
            return (
              <div key={device.id} className="bg-bg-card border border-border rounded-lg p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Smartphone size={18} className="text-accent" />
                    <h3 className="font-semibold">{device.name}</h3>
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>

                <div className="space-y-1.5 text-sm text-text-secondary mb-4">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono bg-bg-primary px-1.5 py-0.5 rounded text-xs">ID: {device.imei}</span>
                  </div>
                  {device.model && (
                    <div>{device.model}</div>
                  )}
                  {device.assignedUserFirstName && (
                    <div className="flex items-center gap-1.5">
                      <User size={14} />
                      <span>{device.assignedUserFirstName} {device.assignedUserLastName}</span>
                    </div>
                  )}
                  {device.assignedGroupName && (
                    <div className="flex items-center gap-1.5">
                      <Radio size={14} />
                      <span>{device.assignedGroupName}</span>
                    </div>
                  )}
                  <div className="text-xs">
                    Last seen: {timeAgo(device.lastSeenAt)}
                    {device.firmwareVersion && ` | FW: ${device.firmwareVersion}`}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-border">
                  <button
                    onClick={() => device.assignedUserId && setQrDevice(device)}
                    disabled={!device.assignedUserId}
                    className={`flex items-center gap-1.5 text-sm transition-colors ${
                      device.assignedUserId
                        ? 'text-text-secondary hover:text-accent'
                        : 'cursor-not-allowed text-text-secondary opacity-40'
                    }`}
                    title={device.assignedUserId ? 'Generate QR provisioning code' : 'Assign a user first'}
                  >
                    <QrCode size={14} />
                    QR
                  </button>
                  <button
                    onClick={() => handleEdit(device)}
                    className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-white transition-colors"
                  >
                    <Edit2 size={14} />
                    Edit
                  </button>
                  {device.assignedUserId && (
                    <button
                      onClick={() => handleUnassign(device)}
                      className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-warning transition-colors"
                      title="Remove this device's user assignment"
                    >
                      <UserMinus size={14} />
                      Unassign
                    </button>
                  )}
                  <button
                    onClick={() => handleToggleDisabled(device)}
                    className={`flex items-center gap-1.5 text-sm transition-colors ${
                      device.status === 'disabled' ? 'text-text-secondary hover:text-success' : 'text-text-secondary hover:text-warning'
                    }`}
                    title={device.status === 'disabled'
                      ? 'Re-enable this device'
                      : 'Disable (lock out) this device within ~15 min, without deleting it'}
                  >
                    <Power size={14} />
                    {device.status === 'disabled' ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(device)}
                    className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-danger transition-colors"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onPageChange={setPage}
        />
      )}

      <DeviceFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={handleFormSuccess}
        editDevice={editDevice}
      />

      <ProvisioningQrModal
        deviceId={qrDevice?.id ?? null}
        deviceName={qrDevice?.name ?? ''}
        onClose={() => setQrDevice(null)}
        onGenerated={refetch}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Device"
        message={`Are you sure you want to delete "${deleteTarget?.name}" (ID: ${deleteTarget?.imei})? This action cannot be undone.`}
      />
    </div>
  );
}
