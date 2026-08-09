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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useWsEvent } from '../../contexts/WebSocketContext';
import { AlertTriangle, BellRing, CheckCircle2, Radio, Trash2 } from 'lucide-react';

type AlarmSeverity = 'critical' | 'warning' | 'info';
type AlarmStatus = 'new' | 'acknowledged';

interface AlarmItem {
  id: string;
  source: 'call' | 'radio' | 'system';
  title: string;
  detail: string;
  severity: AlarmSeverity;
  status: AlarmStatus;
  timestamp: string;
}

interface EmergencyCall {
  id: string;
  number: number;
  name: string;
  address: string | null;
  createdAt: string;
}

interface DeviceItem {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
}

const severityClass: Record<AlarmSeverity, string> = {
  critical: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
};

export function AlarmsPanel() {
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const [loading, setLoading] = useState(true);

  const upsertAlarm = useCallback((alarm: AlarmItem) => {
    setAlarms((prev) => {
      const idx = prev.findIndex((a) => a.id === alarm.id);
      if (idx === -1) return [alarm, ...prev].slice(0, 200);
      const next = [...prev];
      next[idx] = { ...next[idx], ...alarm };
      return next;
    });
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [callsRes, devicesRes] = await Promise.all([
        apiFetch<EmergencyCall[]>(`/calls?state=active&priority=emergency&limit=50`),
        apiFetch<DeviceItem[]>(`/devices?limit=100`),
      ]);

      const callAlarms: AlarmItem[] = (callsRes.data || []).map((c) => ({
        id: `call-${c.id}`,
        source: 'call',
        title: `Emergency Call #${c.number}`,
        detail: c.address ? `${c.name} - ${c.address}` : c.name,
        severity: 'critical',
        status: 'new',
        timestamp: c.createdAt,
      }));

      const deviceAlarms: AlarmItem[] = (devicesRes.data || [])
        .filter((d) => d.status === 'pending' || d.status === 'disabled')
        .map((d) => ({
          id: `device-${d.id}`,
          source: 'radio',
          title: `Radio Device ${d.status.toUpperCase()}`,
          detail: `${d.name} requires attention`,
          severity: d.status === 'disabled' ? 'critical' : 'warning',
          status: 'new',
          timestamp: d.lastSeenAt || new Date().toISOString(),
        }));

      setAlarms(
        [...callAlarms, ...deviceAlarms].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        ),
      );
    } catch {
      setAlarms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useWsEvent('call:created', (event: any) => {
    if (event?.priority !== 'emergency') return;
    upsertAlarm({
      id: `call-${event.callId}`,
      source: 'call',
      title: 'New Emergency Call',
      detail: event.name || 'Emergency call created',
      severity: 'critical',
      status: 'new',
      timestamp: event.timestamp || new Date().toISOString(),
    });
  });

  useWsEvent('device:updated', (event: any) => {
    upsertAlarm({
      id: `device-update-${event.deviceId}-${event.timestamp || Date.now()}`,
      source: 'radio',
      title: 'Radio Device Update',
      detail: `Device ${event.deviceId} status changed`,
      severity: 'info',
      status: 'new',
      timestamp: event.timestamp || new Date().toISOString(),
    });
  });

  const counts = useMemo(
    () => ({
      total: alarms.length,
      open: alarms.filter((a) => a.status === 'new').length,
      critical: alarms.filter((a) => a.severity === 'critical').length,
    }),
    [alarms],
  );

  function acknowledge(id: string) {
    setAlarms((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'acknowledged' } : a)));
  }

  function clear(id: string) {
    setAlarms((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="w-80 bg-bg-sidebar border-r border-border flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <BellRing size={14} className="text-accent" />
          <span className="text-sm font-semibold">Alarm Center</span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <Stat label="Total" value={counts.total} />
          <Stat label="Open" value={counts.open} />
          <Stat label="Critical" value={counts.critical} highlight />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : alarms.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-6">No active alarms.</p>
        ) : (
          alarms.map((alarm) => (
            <div key={alarm.id} className="bg-bg-card border border-border rounded-lg p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    {alarm.source === 'radio' ? (
                      <Radio size={11} className="text-warning" />
                    ) : (
                      <AlertTriangle size={11} className={severityClass[alarm.severity]} />
                    )}
                    <p className="text-xs font-semibold truncate">{alarm.title}</p>
                  </div>
                  <p className="text-[11px] text-text-secondary mt-0.5">{alarm.detail}</p>
                </div>
                <span className={`text-[10px] uppercase ${severityClass[alarm.severity]}`}>{alarm.severity}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-text-secondary">
                  {new Date(alarm.timestamp).toLocaleTimeString()}
                </span>
                <div className="flex items-center gap-1">
                  {alarm.status === 'new' && (
                    <button
                      onClick={() => acknowledge(alarm.id)}
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-success/20 text-success text-[10px] cursor-pointer"
                    >
                      <CheckCircle2 size={10} />
                      Ack
                    </button>
                  )}
                  <button
                    onClick={() => clear(alarm.id)}
                    className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-danger/20 text-danger text-[10px] cursor-pointer"
                  >
                    <Trash2 size={10} />
                    Clear
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded border px-1.5 py-1 text-center ${highlight ? 'border-danger/40' : 'border-border'}`}>
      <p className={`text-sm font-semibold ${highlight ? 'text-danger' : 'text-white'}`}>{value}</p>
      <p className="text-[10px] text-text-secondary uppercase">{label}</p>
    </div>
  );
}
