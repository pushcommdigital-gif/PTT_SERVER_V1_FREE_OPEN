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
import { useMemo, useState } from 'react';
import { Radio, Plus, Pencil, Trash2 } from 'lucide-react';
import { useVoiceChannels, type VoiceChannelData } from '../hooks/useVoiceChannels';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { VoiceChannelFormModal } from '../components/voice/VoiceChannelFormModal';
import { apiFetch } from '../lib/api';

export function VoiceChannelsPage() {
  const { channels, loading, refetch } = useVoiceChannels();
  const [createOpen, setCreateOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<VoiceChannelData | null>(null);
  const [deleteChannel, setDeleteChannel] = useState<VoiceChannelData | null>(null);

  async function handleDelete() {
    if (!deleteChannel) return;
    await apiFetch(`/voice-channels/${deleteChannel.id}`, { method: 'DELETE' });
    setDeleteChannel(null);
    refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Voice Channels</h1>
          <p className="text-text-secondary mt-1">{channels.length} total channels</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={18} /> Create Channel
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg bg-bg-card border border-border p-5 animate-pulse h-44" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <Card>
          <p className="text-text-secondary text-center py-8">
            No voice channels yet. Create your first channel.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <Card key={channel.id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Radio size={14} className="text-accent shrink-0" />
                    <h3 className="font-semibold text-lg truncate">{channel.name}</h3>
                  </div>
                  {channel.isDefault ? <Badge variant="success">Default</Badge> : <Badge>No</Badge>}
                </div>
                <div className="space-y-1 text-sm text-text-secondary">
                  <p>Order: {channel.displayOrder}</p>
                  <p>
                    Assignments: {channel.assignedGroupCount} groups / {channel.assignedUserCount} users
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                <Button variant="ghost" size="sm" onClick={() => setEditChannel(channel)}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteChannel(channel)}
                  className="text-danger hover:text-danger"
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <VoiceChannelFormModal
        open={createOpen || !!editChannel}
        onClose={() => {
          setCreateOpen(false);
          setEditChannel(null);
        }}
        channel={editChannel}
        onSuccess={refetch}
      />

      <ConfirmDialog
        open={!!deleteChannel}
        onClose={() => setDeleteChannel(null)}
        onConfirm={handleDelete}
        title="Delete Voice Channel"
        message={`Are you sure you want to delete "${deleteChannel?.name}"?`}
      />
    </div>
  );
}
