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
import { Users, Radio, Layers } from 'lucide-react';
import { useVoice } from '../../contexts/VoiceContext';
import { useChannelMembers } from '../../hooks/useChannelMembers';
import { Badge } from '../ui/Badge';

export function ChannelMembersPanel() {
  const voice = useVoice();
  const { summary, loading, error } = useChannelMembers(voice.currentChannelId);

  if (!voice.currentChannelId) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div>
          <Radio size={28} className="mx-auto text-text-secondary/40 mb-2" />
          <p className="text-sm text-text-secondary">Join a channel to view expected members.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-text-secondary">
        Loading channel members...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-danger text-sm">
        {error}
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <div className="rounded-lg border border-border bg-bg-primary p-3">
        <div className="flex items-center gap-2 mb-1">
          <Radio size={14} className="text-accent" />
          <h3 className="text-sm font-semibold">{summary.channel.name}</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Layers size={12} />
          <span>{summary.assignedGroups.length} groups assigned</span>
          <span>-</span>
          <span>{summary.directUsers.length} direct users assigned</span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-bg-primary p-3">
        <h4 className="text-xs font-semibold text-text-secondary uppercase mb-2">Expected Members</h4>
        {summary.expectedMembers.length === 0 ? (
          <p className="text-xs text-text-secondary">No assigned members for this channel.</p>
        ) : (
          <div className="space-y-2">
            {summary.expectedMembers.map((member) => (
              <div key={member.userId} className="border border-border rounded-md px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate">
                      {member.firstName} {member.lastName}
                    </p>
                    <p className="text-xs text-text-secondary">{member.role}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {member.viaDirect && <Badge variant="accent">Direct</Badge>}
                    {member.viaGroups.length > 0 && <Badge variant="info">Group</Badge>}
                  </div>
                </div>
                {member.viaGroups.length > 0 && (
                  <p className="text-[11px] text-text-secondary mt-1">
                    via {member.viaGroups.map((g) => g.groupName).join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {summary.assignedGroups.length > 0 && (
        <div className="rounded-lg border border-border bg-bg-primary p-3">
          <h4 className="text-xs font-semibold text-text-secondary uppercase mb-2">Assigned Groups</h4>
          <div className="flex flex-wrap gap-1">
            {summary.assignedGroups.map((group) => (
              <Badge key={group.groupId}>{group.name}</Badge>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-bg-primary p-3 text-xs text-text-secondary">
        <div className="flex items-center gap-1 mb-1">
          <Users size={12} />
          <span>
            Effective list: {summary.expectedMembers.length} user{summary.expectedMembers.length === 1 ? '' : 's'}
          </span>
        </div>
        <p>Includes direct channel assignments plus users inherited from assigned groups.</p>
      </div>
    </div>
  );
}

