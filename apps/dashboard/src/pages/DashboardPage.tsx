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
import { useNavigate } from 'react-router-dom';
import { useStats } from '../hooks/useStats';
import { useHealth } from '../hooks/useHealth';
import { Card } from '../components/ui/Card';
import { Users, UserCheck, Radio, Phone, Wifi, Shield, Smartphone, Activity, Mail, LockKeyhole } from 'lucide-react';

// Derive the dispatch URL from the current host at RUNTIME so it follows whatever
// domain this install is served on (manage.<domain> → dispatch.<domain>). A
// build-time VITE_DISPATCH_URL still wins if explicitly set (e.g. local dev).
function resolveDispatchUrl(): string {
  if (import.meta.env.VITE_DISPATCH_URL) return import.meta.env.VITE_DISPATCH_URL as string;
  const { protocol, hostname, port } = window.location;
  const host = hostname.startsWith('manage.')
    ? `dispatch.${hostname.slice('manage.'.length)}`
    : `dispatch.${hostname}`;
  return `${protocol}//${host}${port ? `:${port}` : ''}`;
}
const DISPATCH_URL = resolveDispatchUrl();

export function DashboardPage() {
  const navigate = useNavigate();
  const { stats, loading: statsLoading, error: statsError } = useStats();
  const { health, loading: healthLoading } = useHealth();

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers ?? '-', icon: Users, color: 'bg-info' },
    { label: 'Active Users', value: stats?.activeUsers ?? '-', icon: UserCheck, color: 'bg-success' },
    { label: 'Devices', value: stats?.totalDevices ?? '-', icon: Smartphone, color: 'bg-warning' },
    { label: 'Online Users', value: stats?.onlineUsers ?? '-', icon: Wifi, color: 'bg-info' },
    { label: 'Groups', value: stats?.totalGroups ?? '-', icon: Radio, color: 'bg-accent' },
    { label: 'Active PTT', value: stats?.activePttSessions ?? '-', icon: Phone, color: 'bg-danger' },
  ];

  const readinessItems = [
    {
      name: 'Core services',
      detail: health?.status === 'ok' ? 'API, database, and Redis are healthy' : 'Check system status',
      ok: health?.status === 'ok',
      icon: Activity,
    },
    {
      name: 'Voice service',
      detail: health?.services.livekit ? 'LiveKit is reachable' : 'LiveKit check failed',
      ok: health?.services.livekit ?? false,
      icon: Radio,
    },
    {
      name: 'Device provisioning',
      detail: `${stats?.activeDevices ?? 0} active / ${stats?.pendingDevices ?? 0} pending`,
      ok: (stats?.totalDevices ?? 0) > 0,
      icon: Smartphone,
    },
    {
      name: 'Login hardening',
      detail: 'CAPTCHA / Turnstile still pending',
      ok: false,
      icon: LockKeyhole,
    },
    {
      name: 'Outbound email',
      detail: 'Transactional email provider still pending',
      ok: false,
      icon: Mail,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard Overview</h1>
        <p className="text-text-secondary">Monitor your PTT system in real-time</p>
        {statsError && (
          <p className="mt-2 text-sm text-danger">
            Stats unavailable: {statsError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">{stat.label}</p>
                <p className="text-3xl font-bold mt-1">{statsLoading ? '...' : stat.value}</p>
              </div>
              <div className={`${stat.color} w-10 h-10 rounded-lg flex items-center justify-center`}>
                <stat.icon size={20} className="text-white" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => window.open(DISPATCH_URL, '_blank')}
              className="bg-danger hover:bg-danger/80 text-white py-3 px-4 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Open Dispatch
            </button>
            <button
              onClick={() => navigate('/users')}
              className="bg-success hover:bg-success/80 text-white py-3 px-4 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Manage Users
            </button>
            <button
              onClick={() => navigate('/groups')}
              className="bg-info hover:bg-info/80 text-white py-3 px-4 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Manage Groups
            </button>
            <button
              onClick={() => navigate('/devices')}
              className="bg-accent hover:bg-accent/80 text-white py-3 px-4 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Manage Devices
            </button>
            <button
              onClick={() => navigate('/roles')}
              className="bg-warning hover:bg-warning/80 text-white py-3 px-4 rounded-lg font-medium transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Shield size={16} /> Manage Roles
            </button>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-4">System Status</h2>
          <div className="space-y-3">
            {[
              {
                name: 'API Server',
                ok: health?.status === 'ok',
                status: health?.status === 'ok' ? 'Online' : 'Offline',
              },
              {
                name: 'Database',
                ok: health?.services.database ?? false,
                status: health?.services.database ? 'Connected' : 'Disconnected',
              },
              {
                name: 'Redis',
                ok: health?.services.redis ?? false,
                status: health?.services.redis ? 'Connected' : 'Disconnected',
              },
              {
                name: 'LiveKit (PTT/Voice)',
                ok: health?.services.livekit ?? false,
                status: health?.services.livekit ? 'Online' : 'Offline',
              },
              {
                name: 'Martin (Map Tiles)',
                ok: health?.services.martin ?? false,
                status: health?.services.martin ? 'Online' : 'Offline',
              },
            ].map((svc) => (
              <div key={svc.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${svc.ok ? 'bg-success' : 'bg-danger'}`} />
                  <span>{svc.name}</span>
                </div>
                <span className={`text-sm ${svc.ok ? 'text-success' : 'text-danger'}`}>
                  {healthLoading ? '...' : svc.status}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-4">System Readiness</h2>
          <div className="space-y-3">
            {readinessItems.map((item) => (
              <div key={item.name} className="flex items-start gap-3">
                <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center ${item.ok ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>
                  <item.icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-text-secondary">{statsLoading || healthLoading ? '...' : item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
