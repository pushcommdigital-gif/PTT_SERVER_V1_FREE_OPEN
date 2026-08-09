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
import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUsers } from '../../hooks/useUsers';
import { useGroups } from '../../hooks/useGroups';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../lib/api';

interface NewMessageModalProps {
  open: boolean;
  onClose: () => void;
  onSent: (type: 'direct' | 'group' | 'broadcast', targetId: string) => void;
}

export function NewMessageModal({ open, onClose, onSent }: NewMessageModalProps) {
  const { user } = useAuth();
  const [type, setType] = useState<'direct' | 'group' | 'broadcast'>('direct');
  const [targetId, setTargetId] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { users } = useUsers({ page: 1, limit: 100, search: '', role: 'all' });
  const { groups } = useGroups({ page: 1, limit: 100, search: '' });

  // Filter out current user from direct message targets
  const availableUsers = users.filter((u) => u.id !== user?.id);

  const handleSend = async () => {
    if (!body.trim()) {
      setError('Message body is required');
      return;
    }
    if (type === 'direct' && !targetId) {
      setError('Select a user');
      return;
    }
    if (type === 'group' && !targetId) {
      setError('Select a group');
      return;
    }

    setSending(true);
    setError(null);

    try {
      await apiFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({
          type,
          targetUserId: type === 'direct' ? targetId : undefined,
          targetGroupId: type === 'group' ? targetId : undefined,
          body: body.trim(),
        }),
      });
      onSent(type, type === 'broadcast' ? 'broadcast' : targetId);
      // Reset form
      setType('direct');
      setTargetId('');
      setBody('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Message" maxWidth="max-w-sm">
      <div className="space-y-3">
        {/* Type selector */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary">Type</label>
          <div className="flex gap-1">
            {(['direct', 'group', 'broadcast'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setType(t); setTargetId(''); setError(null); }}
                className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer capitalize ${
                  type === t
                    ? 'bg-accent text-white'
                    : 'bg-bg-primary text-text-secondary hover:bg-white/5'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Target selector */}
        {type === 'direct' && (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-secondary">To</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full rounded-lg bg-bg-primary border border-border px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Select user...</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
          </div>
        )}

        {type === 'group' && (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-secondary">Group</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full rounded-lg bg-bg-primary border border-border px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Select group...</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {type === 'broadcast' && (
          <p className="text-xs text-text-secondary/60 bg-white/5 rounded px-2 py-1.5">
            This message will be sent to everyone in your department.
          </p>
        )}

        {/* Body */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Type your message..."
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent resize-none"
          />
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSend} loading={sending}>
            Send
          </Button>
        </div>
      </div>
    </Modal>
  );
}
