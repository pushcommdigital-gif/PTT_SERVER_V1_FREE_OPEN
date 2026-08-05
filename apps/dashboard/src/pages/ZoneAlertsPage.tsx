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
import { useState, useEffect } from 'react';
import { useZoneAlerts, type ZoneAlertEntry } from '../hooks/useZoneAlerts';
import { useDebounce } from '../hooks/useDebounce';
import { DataTable, Pagination, Badge, ConfirmDialog, CoordLink } from '../components/ui';
import { apiFetch } from '../lib/api';
import { exportCsv, exportTxt, printTable, shareOrDownload, type ExportCol } from '../lib/exportData';
import { SUPER_ADMIN_LEVEL } from '@pushcomm/shared';
import { Trash2, Download, Printer, Share2, FileText, RotateCcw, LogIn, LogOut } from 'lucide-react';
import type { Column } from '../components/ui/DataTable';

function getJwtRoleLevel(): number {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return 0;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.roleLevel === 'number' ? payload.roleLevel : 0;
  } catch {
    return 0;
  }
}

function formatCoords(lat: string | null, lon: string | null): string {
  if (!lat || !lon) return '—';
  return `${parseFloat(lat).toFixed(5)}, ${parseFloat(lon).toFixed(5)}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

const EXPORT_COLS: ExportCol[] = [
  { key: 'user', label: 'User' },
  { key: 'zoneType', label: 'Type' },
  { key: 'zoneName', label: 'Zone' },
  { key: 'alertType', label: 'Alert' },
  { key: 'location', label: 'Location' },
  { key: 'triggeredAt', label: 'Triggered' },
];

function toExportRows(entries: ZoneAlertEntry[]) {
  return entries.map((e) => ({
    user: `${e.firstName} ${e.lastName}`.trim() || e.username,
    zoneType: e.zoneType === 'geofence' ? 'Geofence' : 'POI',
    zoneName: e.zoneName,
    alertType: e.alertType === 'enter' ? 'Enter' : 'Exit',
    location: formatCoords(e.latitude, e.longitude),
    triggeredAt: formatDateTime(e.triggeredAt),
  }));
}

export function ZoneAlertsPage() {
  const isSuperAdmin = getJwtRoleLevel() >= SUPER_ADMIN_LEVEL;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [zoneType, setZoneType] = useState('');
  const [alertType, setAlertType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const { entries, pagination, loading, refetch } = useZoneAlerts({
    page,
    limit: 50,
    search: debouncedSearch,
    zoneType,
    alertType,
    from,
    to,
  });

  useEffect(() => { setPage(1); }, [debouncedSearch, zoneType, alertType, from, to]);

  const [deleteTarget, setDeleteTarget] = useState<ZoneAlertEntry | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  async function handleDelete() {
    if (!deleteTarget) return;
    await apiFetch(`/zone-alerts/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    refetch();
  }

  async function handleBulkDelete() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    await apiFetch(`/zone-alerts?${params}`, { method: 'DELETE' });
    setBulkDeleteOpen(false);
    refetch();
  }

  function resetFilters() {
    setSearch(''); setZoneType(''); setAlertType(''); setFrom(''); setTo(''); setPage(1);
  }

  const hasFilters = search || zoneType || alertType || from || to;
  const exportRows = toExportRows(entries);
  const exportFilename = `zone-alerts-${new Date().toISOString().slice(0, 10)}`;

  const columns: Column<ZoneAlertEntry>[] = [
    {
      key: 'user',
      header: 'User',
      render: (e) => (
        <span className="font-medium">{`${e.firstName} ${e.lastName}`.trim() || e.username}</span>
      ),
    },
    {
      key: 'zoneType',
      header: 'Type',
      render: (e) => (
        <Badge variant={e.zoneType === 'geofence' ? 'info' : 'warning'}>
          {e.zoneType === 'geofence' ? 'Geofence' : 'POI'}
        </Badge>
      ),
    },
    {
      key: 'zoneName',
      header: 'Zone',
      render: (e) => <span className="font-medium">{e.zoneName}</span>,
    },
    {
      key: 'alertType',
      header: 'Alert',
      render: (e) => (
        <span className={`inline-flex items-center gap-1 text-sm font-medium ${e.alertType === 'enter' ? 'text-success' : 'text-warning'}`}>
          {e.alertType === 'enter' ? <LogIn size={13} /> : <LogOut size={13} />}
          {e.alertType === 'enter' ? 'Enter' : 'Exit'}
        </span>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (e) => <CoordLink lat={e.latitude} lon={e.longitude} />,
    },
    {
      key: 'triggeredAt',
      header: 'Triggered',
      render: (e) => <span className="text-text-secondary text-sm">{formatDateTime(e.triggeredAt)}</span>,
    },
    ...(isSuperAdmin
      ? [{
          key: 'actions',
          header: '',
          render: (e: ZoneAlertEntry) => (
            <button
              onClick={() => setDeleteTarget(e)}
              className="p-1.5 text-text-secondary hover:text-danger rounded transition-colors"
              title="Delete record"
            >
              <Trash2 size={14} />
            </button>
          ),
        } as Column<ZoneAlertEntry>]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Zone Alerts</h1>
          <p className="text-text-secondary mt-1">
            {pagination?.total ?? 0} alert{(pagination?.total ?? 0) !== 1 ? 's' : ''}
            {hasFilters ? ' (filtered)' : ''}
          </p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setBulkDeleteOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-danger border border-danger/30 hover:bg-danger/10 transition-colors"
          >
            <Trash2 size={14} />
            Bulk Delete
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase tracking-wide">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zone or user name..."
            className="w-52 rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white placeholder:text-text-secondary focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase tracking-wide">Zone Type</label>
          <select
            value={zoneType}
            onChange={(e) => setZoneType(e.target.value)}
            className="rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          >
            <option value="">All</option>
            <option value="geofence">Geofence</option>
            <option value="poi">POI</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase tracking-wide">Alert</label>
          <select
            value={alertType}
            onChange={(e) => setAlertType(e.target.value)}
            className="rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          >
            <option value="">All</option>
            <option value="enter">Enter</option>
            <option value="exit">Exit</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase tracking-wide">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase tracking-wide">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>

        {hasFilters && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-white border border-border hover:border-border/70 transition-colors"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        )}
      </div>

      {/* Export bar */}
      {entries.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-secondary uppercase tracking-wide mr-1">Export:</span>
          <button
            onClick={() => printTable(exportRows, EXPORT_COLS, 'Zone Alerts')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-text-secondary hover:text-white hover:border-border/70 transition-colors"
          >
            <Printer size={13} /> Print / PDF
          </button>
          <button
            onClick={() => exportCsv(exportRows, EXPORT_COLS, `${exportFilename}.csv`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-text-secondary hover:text-white hover:border-border/70 transition-colors"
          >
            <Download size={13} /> CSV
          </button>
          <button
            onClick={() => exportTxt(exportRows, EXPORT_COLS, `${exportFilename}.txt`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-text-secondary hover:text-white hover:border-border/70 transition-colors"
          >
            <FileText size={13} /> TXT
          </button>
          <button
            onClick={() => {
              const lines = [
                EXPORT_COLS.map((c) => c.label).join('\t'),
                ...exportRows.map((r) => EXPORT_COLS.map((c) => String(r[c.key as keyof typeof r] ?? '')).join('\t')),
              ];
              shareOrDownload(lines.join('\n'), `${exportFilename}.txt`);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-text-secondary hover:text-white hover:border-border/70 transition-colors"
          >
            <Share2 size={13} /> Share
          </button>
        </div>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={entries}
        keyExtractor={(e) => e.id}
        loading={loading}
        emptyMessage="No zone alerts recorded."
      />

      {pagination && pagination.totalPages > 1 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onPageChange={setPage}
        />
      )}

      {/* Delete single */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Alert Record"
        message={`Permanently delete this ${deleteTarget?.zoneType === 'geofence' ? 'geofence' : 'POI'} alert for ${deleteTarget ? `${deleteTarget.firstName} ${deleteTarget.lastName}`.trim() || deleteTarget.username : ''}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Bulk delete */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title="Bulk Delete Zone Alerts"
        message={from || to
          ? `Permanently delete all zone alerts${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}? This cannot be undone.`
          : 'Permanently delete ALL zone alert records for this department? This cannot be undone.'}
        confirmLabel="Delete All"
        variant="danger"
      />
    </div>
  );
}
