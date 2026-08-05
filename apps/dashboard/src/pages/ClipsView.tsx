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
import { useState, useRef } from 'react';
import { useVoiceRecordings, type VoiceRecording } from '../hooks/useVoiceRecordings';
import { useDebounce } from '../hooks/useDebounce';
import { Pagination, ConfirmDialog, Modal } from '../components/ui';
import { WaveformPlayer } from '../components/ui/WaveformPlayer';
import { apiFetch } from '../lib/api';
import { downloadClips } from '../lib/downloadClips';
import { getJwtRoleLevel } from '../lib/authRole';
import { ADMIN_LEVEL } from '@pushcomm/shared';
import { Play, Square, Trash2, Download, Loader2 } from 'lucide-react';

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'recording', label: 'Recording' },
  { key: 'processing', label: 'Processing' },
  { key: 'failed', label: 'Failed' },
] as const;

const STATUS_COLORS: Record<string, string> = {
  ready: 'bg-success/20 text-success',
  recording: 'bg-danger/20 text-danger animate-pulse',
  processing: 'bg-warning/20 text-warning',
  failed: 'bg-border text-text-secondary',
};

function clipName(r: VoiceRecording): string {
  return r.speakerLabel || `${r.speakerFirstName ?? ''} ${r.speakerLastName ?? ''}`.trim() || 'Unknown';
}
function formatDuration(sec: number | null | undefined) {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
function formatSize(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Flat, file-centric view of every clip (the former Recordings page) with
// multi-select bulk delete/download. Lives inside the CDR page's "Clips" tab.
export function ClipsView() {
  const canManage = getJwtRoleLevel() >= ADMIN_LEVEL;
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { recordings, pagination, loading, refetch } = useVoiceRecordings({ page, limit: 25, search, status: statusFilter });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playerRec, setPlayerRec] = useState<VoiceRecording | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VoiceRecording | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const pageIds = recordings.map((r) => r.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAll() {
    setSelected((prev) => {
      const n = new Set(prev);
      if (allSelected) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function quickPlay(e: React.MouseEvent, rec: VoiceRecording) {
    e.stopPropagation();
    if (rec.status !== 'ready' || !rec.filePath) return;
    if (playingId === rec.id) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const token = localStorage.getItem('accessToken');
    const el = new Audio(`/api/voice-recordings/${rec.id}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    el.onended = () => setPlayingId(null);
    el.onerror = () => setPlayingId(null);
    el.play().catch(() => setPlayingId(null));
    audioRef.current = el;
    setPlayingId(rec.id);
  }

  function openPlayer(rec: VoiceRecording) {
    if (rec.status !== 'ready' || !rec.filePath) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
    setPlayerRec(rec);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await apiFetch(`/voice-recordings/${deleteTarget.id}`, { method: 'DELETE' });
    setSelected((prev) => { const n = new Set(prev); n.delete(deleteTarget.id); return n; });
    setDeleteTarget(null);
    refetch();
  }

  async function bulkDelete() {
    setBusy(true);
    try {
      await apiFetch('/voice-recordings/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
      setSelected(new Set());
      setBulkConfirm(false);
      refetch();
    } finally {
      setBusy(false);
    }
  }

  async function bulkDownload() {
    setBusy(true);
    try {
      // Map all selected ids (across pages); name nicely when the row is loaded,
      // else fall back to the id. downloadClips skips any that 404 (failed/no file).
      const byId = new Map(recordings.map((r) => [r.id, r]));
      const items = [...selected].map((id) => {
        const r = byId.get(id);
        return { id, name: r ? `${clipName(r)}-${new Date(r.startedAt).toISOString().slice(0, 19)}` : id };
      });
      await downloadClips(items);
    } finally {
      setBusy(false);
    }
  }

  const playerTitle = playerRec ? `${clipName(playerRec)} · ${playerRec.channelName ?? 'Private call'}` : '';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
          placeholder="Search by speaker…"
          className="w-60 rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white placeholder:text-text-secondary focus:border-accent focus:outline-none"
        />
        <div className="flex gap-1 bg-bg-card rounded-lg p-1 border border-border">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setStatusFilter(tab.key); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === tab.key ? 'bg-accent text-white' : 'text-text-secondary hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-lg px-4 py-2">
          <span className="text-sm font-medium text-white">{selected.size} selected</span>
          <button onClick={bulkDownload} disabled={busy} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-white disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download
          </button>
          {canManage && (
            <button onClick={() => setBulkConfirm(true)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm text-danger hover:text-danger/80 disabled:opacity-40">
              <Trash2 size={14} /> Delete
            </button>
          )}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-text-secondary hover:text-white">Clear</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
        ) : recordings.length === 0 ? (
          <p className="text-center text-text-secondary py-12 text-sm">No recordings found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-sidebar/40 text-xs font-semibold text-text-secondary uppercase tracking-wider">
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all on this page" className="cursor-pointer accent-accent" />
                </th>
                <th className="px-2 py-3 w-8" />
                <th className="px-4 py-3 text-left">Speaker</th>
                <th className="px-4 py-3 text-left">Channel</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Duration</th>
                <th className="px-4 py-3 text-left">Size</th>
                <th className="px-4 py-3 text-left">Recorded</th>
                {canManage && <th className="px-4 py-3 w-10" />}
              </tr>
            </thead>
            <tbody>
              {recordings.map((rec) => {
                const playable = rec.status === 'ready' && !!rec.filePath;
                return (
                  <tr
                    key={rec.id}
                    onClick={() => openPlayer(rec)}
                    className={`border-b border-border text-xs hover:bg-white/3 ${playable ? 'cursor-pointer' : ''} ${selected.has(rec.id) ? 'bg-accent/5' : ''}`}
                  >
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(rec.id)} onChange={() => toggleOne(rec.id)} className="cursor-pointer accent-accent" />
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        onClick={(e) => quickPlay(e, rec)}
                        disabled={!playable}
                        className="p-1 rounded bg-accent/20 text-accent disabled:opacity-30 cursor-pointer"
                        title={playingId === rec.id ? 'Stop' : 'Play'}
                      >
                        {playingId === rec.id ? <Square size={11} /> : <Play size={11} />}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col leading-tight">
                        <span className="font-medium text-white">{clipName(rec)}</span>
                        {rec.speakerUsername && <span className="text-[10px] text-text-secondary">@{rec.speakerUsername}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">{rec.channelName ?? (rec.targetLabel || 'Private')}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[rec.status] ?? ''}`}>{rec.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">{formatDuration(rec.durationSec)}</td>
                    <td className="px-4 py-2.5 text-text-secondary">{formatSize(rec.fileSize)}</td>
                    <td className="px-4 py-2.5 text-text-secondary">{new Date(rec.startedAt).toLocaleString()}</td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setDeleteTarget(rec)} className="p-1.5 text-text-secondary hover:text-danger rounded transition-colors" title="Delete recording">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
      )}

      <Modal open={!!playerRec} onClose={() => setPlayerRec(null)} title={playerTitle} maxWidth="max-w-2xl">
        {playerRec && <WaveformPlayer rec={playerRec} />}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Recording"
        message={`Delete this recording from ${deleteTarget ? clipName(deleteTarget) : ''}? The audio file will be permanently removed.`}
      />
      <ConfirmDialog
        open={bulkConfirm}
        onClose={() => setBulkConfirm(false)}
        onConfirm={bulkDelete}
        title="Delete recordings"
        message={`Permanently delete ${selected.size} selected recording(s) and their audio files? This cannot be undone.`}
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
      />
    </div>
  );
}
