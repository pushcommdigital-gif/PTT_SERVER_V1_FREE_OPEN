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
import { useCallback, useEffect, useRef, useState } from 'react';
import { LogIn, LogOut, MapPin, X, Clock } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useWsEvent } from '../../contexts/WebSocketContext';

interface ZoneAlertEntry {
  id: string;
  zoneType: 'geofence' | 'poi';
  zoneName: string;
  alertType: 'enter' | 'exit';
  latitude: string | null;
  longitude: string | null;
  triggeredAt: string;
  firstName: string;
  lastName: string;
  username: string;
}

/** Returns the ISO date string for start of today (local time) */
function todayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/** ms until next midnight */
function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

export function ZoneAlertsPanel() {
  const [entries, setEntries] = useState<ZoneAlertEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [day, setDay] = useState(todayStart);
  const midnightRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Schedule reset at midnight
  useEffect(() => {
    function scheduleMidnight() {
      midnightRef.current = setTimeout(() => {
        setDay(todayStart());
        setDismissed(new Set());
        scheduleMidnight();
      }, msUntilMidnight());
    }
    scheduleMidnight();
    return () => { if (midnightRef.current) clearTimeout(midnightRef.current); };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ZoneAlertEntry[]>(`/zone-alerts?limit=200&from=${day}&to=${day}`);
      setEntries((res as any).data ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => { load(); }, [load]);

  // Prepend new alert from WS without refetching
  function prependAlert(raw: any, zoneType: 'geofence' | 'poi') {
    const entry: ZoneAlertEntry = {
      id: `ws-${Date.now()}-${Math.random()}`,
      zoneType,
      zoneName: zoneType === 'geofence' ? raw.geofenceName : raw.poiName,
      alertType: raw.type,
      latitude: raw.latitude != null ? String(raw.latitude) : null,
      longitude: raw.longitude != null ? String(raw.longitude) : null,
      triggeredAt: raw.timestamp ?? new Date().toISOString(),
      firstName: raw.firstName ?? '',
      lastName: raw.lastName ?? '',
      username: '',
    };
    setEntries((prev) => [entry, ...prev].slice(0, 200));
  }

  useWsEvent('geofence:alert', (e: any) => prependAlert(e, 'geofence'));
  useWsEvent('poi:alert', (e: any) => prependAlert(e, 'poi'));

  const visible = entries.filter((e) => !dismissed.has(e.id));
  const enters = entries.filter((e) => e.alertType === 'enter').length;
  const exits = entries.filter((e) => e.alertType === 'exit').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header stats */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <p className="text-[10px] text-text-secondary uppercase tracking-wide mb-1.5">Today's zone events</p>
        <div className="grid grid-cols-3 gap-1">
          <Stat label="Total" value={entries.length} />
          <Stat label="Enters" value={enters} color="text-success" />
          <Stat label="Exits" value={exits} color="text-warning" />
        </div>
      </div>

      {/* Alert list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-6">No zone alerts today.</p>
        ) : (
          visible.map((entry) => {
            const name = `${entry.firstName} ${entry.lastName}`.trim() || entry.username || 'Unknown';
            const isEnter = entry.alertType === 'enter';
            const isGeo = entry.zoneType === 'geofence';
            const coords = entry.latitude && entry.longitude
              ? `${parseFloat(entry.latitude).toFixed(5)}, ${parseFloat(entry.longitude).toFixed(5)}`
              : null;

            return (
              <div
                key={entry.id}
                className={`bg-bg-card border rounded-lg p-2 ${isEnter ? 'border-success/40' : 'border-warning/40'}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {isEnter
                    ? <LogIn size={11} className="text-success shrink-0" />
                    : <LogOut size={11} className="text-warning shrink-0" />}
                  <span className={`text-xs font-semibold ${isEnter ? 'text-success' : 'text-warning'}`}>
                    {isEnter ? 'ENTER' : 'EXIT'}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isGeo ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}
                  >
                    {isGeo ? 'GEO' : 'POI'}
                  </span>
                  <button
                    onClick={() => setDismissed((prev) => new Set([...prev, entry.id]))}
                    className="ml-auto text-text-secondary/50 hover:text-text-secondary transition-colors shrink-0"
                    title="Dismiss"
                  >
                    <X size={11} />
                  </button>
                </div>

                <p className="text-xs text-white font-medium truncate">{name}</p>
                <p className="text-[11px] text-text-secondary truncate">{entry.zoneName}</p>

                {coords && (
                  <div className="flex items-center gap-1 text-[10px] text-text-secondary mt-0.5">
                    <MapPin size={9} className="shrink-0" />
                    <span className="font-mono">{coords}</span>
                  </div>
                )}

                <div className="flex items-center gap-1 text-[10px] text-text-secondary mt-0.5">
                  <Clock size={9} className="shrink-0" />
                  <span>{new Date(entry.triggeredAt).toLocaleTimeString()}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded border border-border px-1.5 py-1 text-center">
      <p className={`text-sm font-semibold ${color ?? 'text-white'}`}>{value}</p>
      <p className="text-[10px] text-text-secondary uppercase">{label}</p>
    </div>
  );
}
