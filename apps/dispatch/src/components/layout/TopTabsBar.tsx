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
import type { ComponentType } from 'react';
import { Activity, BellRing, Headphones, Inbox, Layers, MapPin, MessageSquare, Users, Hexagon, History } from 'lucide-react';
import { useLayout } from '../../contexts/LayoutContext';
import { getRegisteredPanels } from '../../addons/registry';

interface TabDef {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

/** Core tabs. Add-on tabs are appended from the panel registry (empty in CE). */
const coreTabs: TabDef[] = [
  { id: 'sidebar', label: 'Group', icon: Users },
  { id: 'voiceRec', label: 'Voice rec...', icon: Headphones },
  { id: 'incomingMessages', label: 'Inbox', icon: Inbox },
  { id: 'message', label: 'Message', icon: MessageSquare },
  { id: 'status', label: 'Status', icon: Activity },
  { id: 'geoFence', label: 'Geo-Fen...', icon: MapPin },
  { id: 'alarmRules', label: 'SOS', icon: BellRing },
  { id: 'zoneAlerts', label: 'Zone Log', icon: Hexagon },
  { id: 'trackReplay', label: 'Track Replay', icon: History },
];

interface TopTabsBarProps {
  messageBadge?: number;
  zoneLayersVisible?: boolean;
  onToggleZoneLayers?: () => void;
}

export function TopTabsBar({ messageBadge = 0, zoneLayersVisible = false, onToggleZoneLayers }: TopTabsBarProps) {
  const layout = useLayout();

  // EXTENSION POINT: registered add-on panels get a tab too. Empty in CE.
  const tabList: TabDef[] = [
    ...coreTabs,
    ...getRegisteredPanels().map((p) => ({ id: p.id, label: p.label, icon: p.icon })),
  ];

  return (
    <div className="h-11 px-3 border-b border-border bg-bg-sidebar/95 backdrop-blur-sm flex items-center gap-1.5 shrink-0 overflow-x-auto">
      {tabList.map((tab) => {
        const Icon = tab.icon;
        const active = layout.panels[tab.id]?.visible ?? false;
        const badge = tab.id === 'message' || tab.id === 'incomingMessages' ? messageBadge : 0;
        return (
          <button
            key={tab.id}
            onClick={() => layout.togglePanel(tab.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors border cursor-pointer ${
              active
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-primary/60 text-text-secondary border-border hover:text-white hover:border-border/70'
            }`}
          >
            <Icon size={14} />
            <span className="font-medium">{tab.label}</span>
            {badge > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      {onToggleZoneLayers && (
        <button
          onClick={onToggleZoneLayers}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors border cursor-pointer ${
            zoneLayersVisible
              ? 'bg-emerald-600/90 text-white border-emerald-400/60 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
              : 'bg-bg-primary/60 text-text-secondary border-border hover:text-white hover:border-border/70'
          }`}
          title={zoneLayersVisible ? 'Hide geofences and POIs on the map' : 'Show geofences and POIs on the map'}
        >
          <Layers size={14} />
          <span className="font-medium">Map Zones</span>
        </button>
      )}
    </div>
  );
}
