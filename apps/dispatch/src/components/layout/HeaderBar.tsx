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
import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useWsStatus } from '../../contexts/WebSocketContext';
import { useSettings } from '../../contexts/SettingsContext';
import { LogOut, Radio, Settings } from 'lucide-react';
import { TemplateManager } from './TemplateManager';
import { SettingsPanel } from './SettingsPanel';

const statusConfig = {
  connected: { color: 'bg-success', label: 'Live' },
  connecting: { color: 'bg-warning animate-pulse', label: 'Connecting...' },
  disconnected: { color: 'bg-danger', label: 'Offline' },
} as const;

export function HeaderBar() {
  const { user, logout } = useAuth();
  const wsStatus = useWsStatus();
  const { timeFormat } = useSettings();
  const [clock, setClock] = useState(() => formatClock(timeFormat));
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setClock(formatClock(timeFormat));
    const timer = setInterval(() => setClock(formatClock(timeFormat)), 1000);
    return () => clearInterval(timer);
  }, [timeFormat]);

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : '?';

  return (
    <>
      <header className="h-10 bg-bg-sidebar border-b border-border flex items-center px-4 shrink-0">
        {/* Left: Logo */}
        <div className="flex items-center gap-2">
          <Radio size={18} className="text-accent" />
          <span className="text-sm font-bold text-accent">PUSHCOMM</span>
          <span className="text-xs text-text-secondary ml-1">Dispatch Console</span>
        </div>

        {/* Center: Clock */}
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm font-mono text-text-secondary">{clock}</span>
        </div>

        {/* Right: Templates + Settings + Status + User */}
        <div className="flex items-center gap-4">
          <TemplateManager />
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-text-secondary hover:text-white transition-colors cursor-pointer"
            title="Settings"
          >
            <Settings size={16} />
          </button>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${statusConfig[wsStatus].color}`} />
            <span className="text-xs text-text-secondary">{statusConfig[wsStatus].label}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-xs font-bold">
              {initials}
            </div>
            <span className="text-xs text-text-secondary">
              {user?.firstName} {user?.lastName}
            </span>
          </div>
          <button
            onClick={logout}
            className="text-text-secondary hover:text-white transition-colors cursor-pointer"
            title="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

function formatClock(timeFormat: '24h' | '12h'): string {
  const now = new Date();
  if (timeFormat === '12h') {
    return now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
