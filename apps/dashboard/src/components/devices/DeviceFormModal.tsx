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
import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { apiFetch } from '../../lib/api';
import type { DeviceData } from '../../hooks/useDevices';

interface DeviceFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (createdDevice?: DeviceData | null) => void;
  editDevice?: DeviceData | null;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
}

export function DeviceFormModal({ open, onClose, onSuccess, editDevice }: DeviceFormModalProps) {
  const [imei, setImei] = useState('');
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      fetchOptions();
      if (editDevice) {
        setImei(editDevice.imei);
        setName(editDevice.name);
        setModel(editDevice.model || '');
        setAssignedUserId(editDevice.assignedUserId || '');
      } else {
        setImei('');
        setName('');
        setModel('');
        setAssignedUserId('');
      }
      setError('');
    }
  }, [open, editDevice]);

  async function fetchOptions() {
    try {
      // Filter to "unassigned users" (no device owned yet) PLUS the user
      // already assigned to THIS device when editing — so the current
      // selection remains visible in the dropdown.
      const includeDeviceParam = editDevice?.id
        ? `&includeDeviceId=${encodeURIComponent(editDevice.id)}`
        : '';
      const usersRes = await apiFetch<any[]>(`/users?unassigned=true&limit=200${includeDeviceParam}`);
      setUserOptions(
        (usersRes.data as any[])?.map((u: any) => ({
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
        })) || [],
      );
    } catch {}
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!editDevice && !assignedUserId) {
      setError('Select the user this device belongs to before generating a QR code.');
      setLoading(false);
      return;
    }

    try {
      const body = {
        imei: imei || undefined,
        name,
        model: model || undefined,
        assignedUserId: assignedUserId || null,
      };

      if (editDevice) {
        await apiFetch(`/devices/${editDevice.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        onSuccess(null);
      } else {
        const res = await apiFetch<DeviceData>('/devices', { method: 'POST', body: JSON.stringify(body) });
        onSuccess(res.data ?? null);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editDevice ? 'Edit Device' : 'Provision Field Device'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {!editDevice && (
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-text-secondary">
            Choose the field user first. After saving, we will generate a one-time QR code so the Android app logs in as that assigned user.
          </div>
        )}

        <Select
          label="Assigned User"
          value={assignedUserId}
          onChange={(e) => setAssignedUserId(e.target.value)}
          options={[
            { value: '', label: editDevice ? 'No user assigned' : 'Select user...' },
            ...userOptions.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` })),
          ]}
          required={!editDevice}
        />

        {/* Removed "Assigned Group" field — the field that actually controls
            voice access is the user's group membership, not the device's.
            The legacy assignedGroupId column stays in the schema as a
            "default group hint" for the rare multi-group-user case, but
            is no longer surfaced in the standard provisioning flow because
            it's a common foot-gun ("I set the device's group, why is voice
            denied?"). See 2026-05-25 chat. */}

        <Input
          label="Device Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Radio Unit 5"
          required
        />

        <Input
          label="Device ID / IMEI"
          value={imei}
          onChange={(e) => setImei(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20))}
          placeholder="Optional. Leave blank to auto-generate."
          disabled={!!editDevice}
        />
        {!editDevice && (
          <p className="-mt-3 text-xs text-text-secondary">
            Use IMEI, serial, or an inventory tag when known. QR provisioning does not require typing it on the phone.
          </p>
        )}

        <Input
          label="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. Inrico T320"
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>
            {editDevice ? 'Save Changes' : 'Save & Generate QR'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
