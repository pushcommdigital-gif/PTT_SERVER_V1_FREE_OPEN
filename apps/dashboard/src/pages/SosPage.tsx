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
import { useSos, type SosEntry } from '../hooks/useSos';
import { useDebounce } from '../hooks/useDebounce';
import { DataTable, Pagination, Badge, Button, ConfirmDialog, CoordLink } from '../components/ui';
import { apiFetch } from '../lib/api';
import { exportCsv, exportTxt, printTable, shareOrDownload, type ExportCol } from '../lib/exportData';
import { ADMIN_LEVEL } from '@pushcomm/shared';
import { Trash2, Download, Printer, Share2, FileText, RotateCcw } from 'lucide-react';
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

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

// Time from SOS trigger to first acknowledgement. The headline operational
// metric: how fast did a dispatcher respond to the emergency?
function formatResponseTime(createdAt: string | null, acknowledgedAt: string | null): string {
  if (!createdAt || !acknowledgedAt) return '—';
  const ms = new Date(acknowledgedAt).getTime() - new Date(createdAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const EXPORT_COLS: ExportCol[] = [
  { key: 'reporterName', label: 'User' },
  { key: 'status', label: 'Status' },
  { key: 'location', label: 'Location' },
  { key: 'triggeredAt', label: 'Triggered' },
  { key: 'acknowledgedBy', label: 'Acknowledged By' },
  { key: 'acknowledgedAt', label: 'Ack Time' },
  { key: 'responseTime', label: 'Response Time' },
];

function toExportRows(entries: SosEntry[]) {
  return entries.map((e) => ({
    reporterName: `${e.firstName} ${e.lastName}`.trim(),
    status: e.status,
    location: formatCoords(e.latitude, e.longitude),
    triggeredAt: formatDateTime(e.createdAt),
    acknowledgedBy:
      e.ackFirstName ? `${e.ackFirstName} ${e.ackLastName ?? ''}`.trim() : '—',
    acknowledgedAt: formatDateTime(e.acknowledgedAt),
    responseTime: formatResponseTime(e.createdAt, e.acknowledgedAt),
  }));
}

export function SosPage() {
  const isAdmin = getJwtRoleLevel() >= ADMIN_LEVEL;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [acknowledgedBy, setAcknowledgedBy] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const { entries, pagination, loading, refetch } = useSos({
    page,
    limit: 25,
    search: debouncedSearch,
    from,
    to,
    acknowledgedBy,
  });

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, from, to, acknowledgedBy]);

  const [deleteTarget, setDeleteTarget] = useState<SosEntry | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    await apiFetch(`/sos/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    refetch();
  }

  function resetFilters() {
    setSearch('');
    setFrom('');
    setTo('');
    setAcknowledgedBy('');
    setPage(1);
  }

  const hasFilters = search || from || to || acknowledgedBy;
  const exportRows = toExportRows(entries);
  const exportFilename = `sos-events-${new Date().toISOString().slice(0, 10)}`;

  const columns: Column<SosEntry>[] = [
    {
      key: 'user',
      header: 'User',
      render: (e) => (
        <span className="font-medium">
          {`${e.firstName} ${e.lastName}`.trim() || 'Unknown'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (e) => (
        <Badge variant={e.status === 'active' ? 'danger' : 'success'}>
          {e.status.toUpperCase()}
        </Badge>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (e) => <CoordLink lat={e.latitude} lon={e.longitude} />,
    },
    {
      key: 'triggered',
      header: 'Triggered',
      render: (e) => (
        <span className="text-text-secondary text-sm">{formatDateTime(e.createdAt)}</span>
      ),
    },
    {
      key: 'ackBy',
      header: 'Acknowledged By',
      render: (e) =>
        e.ackFirstName ? (
          <span className="text-sm">{`${e.ackFirstName} ${e.ackLastName ?? ''}`.trim()}</span>
        ) : (
          <span className="text-text-secondary text-sm">—</span>
        ),
    },
    {
      key: 'ackAt',
      header: 'Ack Time',
      render: (e) => (
        <span className="text-text-secondary text-sm">{formatDateTime(e.acknowledgedAt)}</span>
      ),
    },
    {
      key: 'responseTime',
      header: 'Response',
      render: (e) => {
        const rt = formatResponseTime(e.createdAt, e.acknowledgedAt);
        return (
          <span className={rt === '—' ? 'text-text-secondary text-sm' : 'text-sm font-medium text-info'}>
            {rt}
          </span>
        );
      },
    },
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: '',
            render: (e: SosEntry) => (
              <button
                onClick={() => setDeleteTarget(e)}
                className="p-1.5 text-text-secondary hover:text-danger rounded transition-colors"
                title="Delete record"
              >
                <Trash2 size={14} />
              </button>
            ),
          } as Column<SosEntry>,
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SOS Events</h1>
          <p className="text-text-secondary mt-1">
            {pagination?.total ?? 0} event{(pagination?.total ?? 0) !== 1 ? 's' : ''}
            {hasFilters ? ' (filtered)' : ''}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase tracking-wide">Search user</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="First or last name..."
            className="w-52 rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white placeholder:text-text-secondary focus:border-accent focus:outline-none"
          />
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

        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase tracking-wide">Dispatcher</label>
          <input
            type="text"
            value={acknowledgedBy}
            onChange={(e) => setAcknowledgedBy(e.target.value)}
            placeholder="Dispatcher name..."
            className="w-44 rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white placeholder:text-text-secondary focus:border-accent focus:outline-none"
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
            onClick={() => printTable(exportRows, EXPORT_COLS, 'SOS Events')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-text-secondary hover:text-white hover:border-border/70 transition-colors"
          >
            <Printer size={13} />
            Print / PDF
          </button>
          <button
            onClick={() => exportCsv(exportRows, EXPORT_COLS, `${exportFilename}.csv`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-text-secondary hover:text-white hover:border-border/70 transition-colors"
          >
            <Download size={13} />
            CSV
          </button>
          <button
            onClick={() => exportTxt(exportRows, EXPORT_COLS, `${exportFilename}.txt`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-text-secondary hover:text-white hover:border-border/70 transition-colors"
          >
            <FileText size={13} />
            TXT
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
            <Share2 size={13} />
            Share
          </button>
        </div>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={entries}
        keyExtractor={(e) => e.id}
        loading={loading}
        emptyMessage="No SOS events found."
      />

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onPageChange={setPage}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete SOS Record"
        message={`Permanently delete the SOS event triggered by ${deleteTarget ? `${deleteTarget.firstName} ${deleteTarget.lastName}`.trim() : 'this user'}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
