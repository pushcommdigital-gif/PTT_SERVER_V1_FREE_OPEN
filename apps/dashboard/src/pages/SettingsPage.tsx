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
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { Card } from '../components/ui/Card';
import { KeyRound, ShieldCheck, Eye, EyeOff, Loader2, Clock } from 'lucide-react';

const SESSION_LABELS: Record<string, string> = {
  never: 'Never — devices stay logged in',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '180d': '180 days',
};

// How long an activated device stays logged in without re-entering the password
// (the device session / refresh-token lifetime). Default "Never"; a lost device is
// cut off promptly by Disabling it on the Devices page regardless of this setting.
function DeviceSessionCard() {
  const [ttl, setTtl] = useState<string>('never');
  const [options, setOptions] = useState<string[]>(['never', '7d', '30d', '90d', '180d']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ ttl: string; options: string[] }>('/settings/device-session')
      .then((r) => { if (r.data) { setTtl(r.data.ttl); if (r.data.options?.length) setOptions(r.data.options); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function change(next: string) {
    setSaving(true);
    setSaved(false);
    const prev = ttl;
    setTtl(next);
    try {
      await apiFetch('/settings/device-session', { method: 'PUT', body: JSON.stringify({ ttl: next }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setTtl(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
        <Clock size={18} className="text-accent" /> Device Session Length
      </h2>
      <p className="text-sm text-text-secondary mb-4">
        How long a field device stays logged in without re-entering its password. A device
        used within this window keeps its session rolling; one offline longer must sign in
        again. Lost a device? Disable it on the Devices page — that locks it out within ~15
        minutes no matter what this is set to.
      </p>
      <div className="flex items-center gap-3">
        <select
          value={ttl}
          onChange={(e) => change(e.target.value)}
          disabled={loading || saving}
          className="rounded-lg bg-bg-sidebar border border-border px-3 py-2 text-sm text-white focus:border-accent outline-none disabled:opacity-50 min-w-[260px]"
        >
          {options.map((o) => <option key={o} value={o}>{SESSION_LABELS[o] ?? o}</option>)}
        </select>
        {saving && <Loader2 size={16} className="animate-spin text-text-secondary" />}
        {saved && <span className="flex items-center gap-1 text-success text-sm"><ShieldCheck size={16} /> Saved</span>}
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ pin: string }>('/settings/logout-pin')
      .then((res) => setPin(res.data?.pin ?? ''))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const valid = /^\d{4,8}$/.test(pin);

  async function save() {
    if (!valid) { setError('PIN must be 4–8 digits.'); return; }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/settings/logout-pin', { method: 'PUT', body: JSON.stringify({ pin }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-text-secondary">Department-wide configuration</p>
      </div>

      <Card className="max-w-xl">
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
          <KeyRound size={18} className="text-accent" /> Field App Logout PIN
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          The PIN a field operator must enter on the Android app to confirm a manual logout.
          This prevents drivers from accidentally signing themselves out. Change it periodically
          for security — it takes effect immediately, no app update needed.
        </p>

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}

        <label className="block text-sm text-text-secondary mb-1">PIN (4–8 digits)</label>
        <div className="flex items-center gap-3">
          <div className="relative w-40">
            <input
              type={showPin ? 'text' : 'password'}
              value={loading ? '' : pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setSaved(false); }}
              placeholder={loading ? 'Loading…' : '4–8 digits'}
              inputMode="numeric"
              disabled={loading}
              className="w-full rounded-lg bg-bg-sidebar border border-border px-3 py-2 pr-10 text-lg tracking-widest text-white focus:border-accent outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowPin((s) => !s)}
              disabled={loading}
              aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-white disabled:opacity-50"
            >
              {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            onClick={save}
            disabled={saving || loading || !valid}
            className="bg-accent hover:bg-accent/80 text-white py-2 px-5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save PIN'}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-success text-sm">
              <ShieldCheck size={16} /> Saved
            </span>
          )}
        </div>
        {!valid && pin.length > 0 && !loading && (
          <p className="mt-2 text-xs text-warning">Must be 4–8 digits.</p>
        )}
      </Card>

      <DeviceSessionCard />
    </div>
  );
}
