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
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type UnitSystem = 'metric' | 'imperial';
export type TimeFormat = '24h' | '12h';
export type MonitorDefault = 'all' | 'last';
export type TransmitDefault = 'none' | 'all' | 'last';
export type MessageAlertVolume = 'low' | 'medium' | 'high';

export interface DispatchSettings {
  unitSystem: UnitSystem;
  timeFormat: TimeFormat;
  monitorDefault: MonitorDefault;
  transmitDefault: TransmitDefault;
  messageSoundEnabled: boolean;
  messageAlertVolume: MessageAlertVolume;
  /** Auto-zoom the map to a unit while it's transmitting (PTT floor holder). */
  followTalker: boolean;
}

interface SettingsContextValue extends DispatchSettings {
  setUnitSystem: (v: UnitSystem) => void;
  setTimeFormat: (v: TimeFormat) => void;
  setMonitorDefault: (v: MonitorDefault) => void;
  setTransmitDefault: (v: TransmitDefault) => void;
  setMessageSoundEnabled: (v: boolean) => void;
  setMessageAlertVolume: (v: MessageAlertVolume) => void;
  setFollowTalker: (v: boolean) => void;
}

const STORAGE_KEY = 'pushcomm:dispatch:settings';

function normalizeTransmitDefault(value: unknown): TransmitDefault {
  if (value === 'none' || value === 'last') return value;
  return 'all';
}

function loadSettings(): DispatchSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DispatchSettings> & { transmitDefault?: unknown };
      return {
        unitSystem: 'metric',
        timeFormat: '24h',
        monitorDefault: 'all',
        messageSoundEnabled: true,
        messageAlertVolume: 'high',
        ...parsed,
        transmitDefault: normalizeTransmitDefault(parsed.transmitDefault),
        followTalker: parsed.followTalker ?? true,
      };
    }
  } catch { /* ignore */ }
  return {
    unitSystem: 'metric',
    timeFormat: '24h',
    monitorDefault: 'all',
    transmitDefault: 'all',
    messageSoundEnabled: true,
    messageAlertVolume: 'high',
    followTalker: true,
  };
}

function saveSettings(s: DispatchSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DispatchSettings>(loadSettings);

  function update(partial: Partial<DispatchSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      return next;
    });
  }

  const value = useMemo<SettingsContextValue>(() => ({
    ...settings,
    setUnitSystem: (v) => update({ unitSystem: v }),
    setTimeFormat: (v) => update({ timeFormat: v }),
    setMonitorDefault: (v) => update({ monitorDefault: v }),
    setTransmitDefault: (v) => update({ transmitDefault: v }),
    setMessageSoundEnabled: (v) => update({ messageSoundEnabled: v }),
    setMessageAlertVolume: (v) => update({ messageAlertVolume: v }),
    setFollowTalker: (v) => update({ followTalker: v }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [settings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
