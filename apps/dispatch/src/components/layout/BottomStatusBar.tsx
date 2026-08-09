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
import { Mic, MessageSquare, Users } from 'lucide-react';
import { useVoice } from '../../contexts/VoiceContext';
import { useGroups } from '../../hooks/useGroups';

export function BottomStatusBar() {
  const voice = useVoice();
  const { groups } = useGroups({ page: 1, limit: 50, search: '', type: '' });

  return (
    <div className="h-8 bg-bg-sidebar border-t border-border flex items-center px-3 shrink-0 gap-2">
      {/* Left: quick action icons */}
      <div className="flex items-center gap-2">
        <button className="text-text-secondary hover:text-white transition-colors cursor-pointer" title="Microphone">
          <Mic size={14} />
        </button>
        <button className="text-text-secondary hover:text-white transition-colors cursor-pointer" title="Messages">
          <MessageSquare size={14} />
        </button>
        <button className="text-text-secondary hover:text-white transition-colors cursor-pointer" title="Contacts">
          <Users size={14} />
        </button>
      </div>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Center: channel/group tabs (scrollable) */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
        {groups.slice(0, 12).map((g) => (
          <div
            key={g.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] whitespace-nowrap bg-bg-primary/60 border border-border text-text-secondary"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${(g.onlineMemberCount ?? 0) > 0 ? 'bg-success' : 'bg-text-secondary/40'}`} />
            {g.name}
          </div>
        ))}
      </div>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Right: current group + speaking */}
      <div className="flex items-center gap-3 shrink-0">
        {voice.currentChannelId && (
          <span className="text-[10px] text-text-secondary">
            Channel: <span className="text-white">{voice.currentChannelId.slice(0, 8)}...</span>
          </span>
        )}
        {voice.floor.held && voice.floor.holderName && (
          <span className="text-[10px] text-accent font-medium animate-pulse">
            Speaking: {voice.floor.holderName}
          </span>
        )}
      </div>
    </div>
  );
}
