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
import { useState, useEffect, useRef } from 'react';
import { useCdr, type PttSession, type PttClip } from '../hooks/useCdr';
import { Pagination, Button, ConfirmDialog } from '../components/ui';
import { WaveformPlayer } from '../components/ui/WaveformPlayer';
import { ClipsView } from './ClipsView';
import { apiFetch } from '../lib/api';
import { getJwtRoleLevel } from '../lib/authRole';
import { ADMIN_LEVEL } from '@pushcomm/shared';
import { exportCsv, exportTxt, printTable, shareOrDownload, type ExportCol } from '../lib/exportData';
import { Phone, PhoneCall, Download, Printer, Share2, FileText, RotateCcw, ChevronDown, ChevronRight, Play, Square, MapPin, X, Trash2 } from 'lucide-react';

function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

// Module-level cache so repeated renders don't re-fetch the same coords
const geocodeCache = new Map<string, string>();

function LocationCoords({ lat, lon, isDispatch }: { lat: string | null; lon: string | null; isDispatch?: boolean }) {
  if (!lat || !lon) {
    return isDispatch
      ? <span className="text-text-secondary">Dispatch</span>
      : <span className="text-text-secondary/40">—</span>;
  }
  const latN = parseFloat(lat);
  const lonN = parseFloat(lon);
  if (Number.isNaN(latN) || Number.isNaN(lonN)) return <span className="text-text-secondary/40">—</span>;
  const href = `https://www.openstreetmap.org/?mlat=${latN}&mlon=${lonN}#map=17/${latN}/${lonN}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Open location in map"
      className="inline-flex items-center gap-1 text-xs tabular-nums text-accent hover:underline"
    >
      <MapPin size={10} className="shrink-0" />
      {latN.toFixed(5)}, {lonN.toFixed(5)}
    </a>
  );
}

function LocationAddress({ lat, lon, isDispatch }: { lat: string | null; lon: string | null; isDispatch?: boolean }) {
  const key = lat && lon ? `${lat},${lon}` : null;
  const [address, setAddress] = useState<string | null>(key ? (geocodeCache.get(key) ?? null) : null);

  useEffect(() => {
    if (!key || !lat || !lon || address) return;
    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
      { headers: { 'Accept-Language': 'en' } },
    )
      .then((r) => r.json())
      .then((j) => {
        const addr = j.display_name ?? '—';
        geocodeCache.set(key, addr);
        setAddress(addr);
      })
      .catch(() => {
        geocodeCache.set(key!, '—');
        setAddress('—');
      });
  }, [key, lat, lon, address]);

  if (!lat || !lon) {
    return isDispatch
      ? <span className="text-text-secondary">Dispatch</span>
      : <span className="text-text-secondary/40">—</span>;
  }
  if (!address) return <span className="text-[10px] text-text-secondary/40 animate-pulse">geocoding…</span>;
  return (
    <span className="text-xs text-text-secondary truncate max-w-xs" title={address}>
      {address}
    </span>
  );
}

// ── Export helpers ────────────────────────────────────────────────────────────

const SUMMARY_COLS: ExportCol[] = [
  { key: 'type', label: 'Type' },
  { key: 'channel', label: 'Channel' },
  { key: 'started', label: 'Started' },
  { key: 'duration', label: 'Duration' },
  { key: 'participants', label: 'Participants' },
  { key: 'clips', label: 'Clips' },
];

interface SessionWithClips extends PttSession { clips: PttClip[] }

function toSummaryRows(sessions: PttSession[]) {
  return sessions.map((s) => ({
    type: s.isPrivate ? 'Private Call' : 'Group PTT',
    channel: s.channelName ?? (s.isPrivate ? 'Private Call' : '—'),
    started: formatDateTime(s.startedAt),
    duration: formatDuration(s.durationSec),
    participants: String(s.maxParticipantCount),
    clips: String(s.clipCount),
  }));
}

function buildDetailsCsv(sessions: SessionWithClips[]): string {
  const lines: string[] = [];
  for (const s of sessions) {
    lines.push(
      `"${s.isPrivate ? 'Private Call' : 'Group PTT'}","${s.channelName ?? '—'}","${formatDateTime(s.startedAt)}","${formatDuration(s.durationSec)}","${s.maxParticipantCount} participants","${s.clipCount} clips"`,
    );
    if (s.clips.length > 0) {
      lines.push(',"Speaker","Time","Duration","Status","Lat","Lon"');
      for (const c of s.clips) {
        const name = c.speakerLabel || `${c.speakerFirstName ?? ''} ${c.speakerLastName ?? ''}`.trim() || 'Unknown';
        lines.push(`,"${name}","${formatDateTime(c.startedAt)}","${formatDuration(c.durationSec)}","${c.status}","${c.locationLat ?? ''}","${c.locationLon ?? ''}"`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildDetailsTxt(sessions: SessionWithClips[]): string {
  const lines: string[] = [];
  for (const s of sessions) {
    lines.push(`[${s.isPrivate ? 'Private Call' : 'Group PTT'}] ${s.channelName ?? '—'} | ${formatDateTime(s.startedAt)} | ${formatDuration(s.durationSec)} | ${s.maxParticipantCount} participants | ${s.clipCount} clips`);
    for (const c of s.clips) {
      const name = c.speakerLabel || `${c.speakerFirstName ?? ''} ${c.speakerLastName ?? ''}`.trim() || 'Unknown';
      const loc = c.locationLat && c.locationLon ? `${parseFloat(c.locationLat).toFixed(5)}, ${parseFloat(c.locationLon).toFixed(5)}` : '—';
      lines.push(`  → ${name} | ${formatDateTime(c.startedAt)} | ${formatDuration(c.durationSec)} | ${c.status} | ${loc}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function geocodeClips(clips: PttClip[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toFetch: { key: string; lat: string; lon: string }[] = [];

  for (const c of clips) {
    if (!c.locationLat || !c.locationLon) continue;
    const key = `${c.locationLat},${c.locationLon}`;
    if (geocodeCache.has(key)) result.set(key, geocodeCache.get(key)!);
    else if (!toFetch.find((x) => x.key === key))
      toFetch.push({ key, lat: c.locationLat, lon: c.locationLon });
  }

  await Promise.all(
    toFetch.map(async ({ key, lat, lon }) => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
          { headers: { 'Accept-Language': 'en' } },
        );
        const j = await r.json();
        const addr = j.display_name ?? `${lat}, ${lon}`;
        geocodeCache.set(key, addr);
        result.set(key, addr);
      } catch {
        result.set(key, `${lat}, ${lon}`);
      }
    }),
  );

  return result;
}

async function printDetailsTable(sessions: SessionWithClips[], title: string) {
  // Geocode all clip locations before rendering the print window
  const allClips = sessions.flatMap((s) => s.clips);
  const addresses = await geocodeClips(allClips);

  const sessionBlocks = sessions.map((s) => {
    const header = `<tr class="session-header"><td colspan="5"><strong>${s.isPrivate ? 'Private Call' : 'Group PTT'}</strong> &mdash; ${s.channelName ?? '—'} &nbsp;|&nbsp; ${formatDateTime(s.startedAt)} &nbsp;|&nbsp; ${formatDuration(s.durationSec)} &nbsp;|&nbsp; ${s.maxParticipantCount} participants</td></tr>`;
    if (s.clips.length === 0) return header + `<tr><td colspan="5" class="no-clips">No clips</td></tr>`;
    const clipHeader = `<tr class="clip-header"><td class="col-speaker">Speaker</td><td class="col-time">Time</td><td class="col-dur">Duration</td><td class="col-status">Status</td><td class="col-loc">Location</td></tr>`;
    const clipRows = s.clips.map((c) => {
      const name = c.speakerLabel || `${c.speakerFirstName ?? ''} ${c.speakerLastName ?? ''}`.trim() || 'Unknown';
      const key = c.locationLat && c.locationLon ? `${c.locationLat},${c.locationLon}` : null;
      const coords = key ? `${parseFloat(c.locationLat!).toFixed(5)}, ${parseFloat(c.locationLon!).toFixed(5)}` : '—';
      const addr = key ? (addresses.get(key) ?? coords) : '—';
      return `<tr class="clip-row"><td class="col-speaker">${name}</td><td class="col-time">${formatDateTime(c.startedAt)}</td><td class="col-dur">${formatDuration(c.durationSec)}</td><td class="col-status">${c.status.toUpperCase()}</td><td class="col-loc">${addr}</td></tr>`;
    }).join('');
    return header + clipHeader + clipRows;
  }).join('<tr class="spacer"><td colspan="5"></td></tr>');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title>
<style>
  body { font-family: sans-serif; font-size: 11px; margin: 16px; }
  h2 { margin-bottom: 4px; font-size: 14px; }
  p.meta { color: #666; font-size: 10px; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  td, th { border: 1px solid #ddd; padding: 4px 6px; vertical-align: top; overflow-wrap: break-word; word-break: break-word; }
  .session-header td { background: #e8f5e9; font-size: 11px; font-weight: 600; padding: 5px 8px; }
  .clip-header td { background: #f5f5f5; font-size: 9px; font-weight: 700; text-transform: uppercase; color: #555; padding: 3px 6px; }
  .clip-row td { font-size: 10px; }
  .no-clips { color: #999; font-style: italic; padding-left: 16px; }
  .spacer td { border: none; height: 6px; }
  .col-speaker { width: 13%; }
  .col-time    { width: 16%; white-space: nowrap; }
  .col-dur     { width: 8%; white-space: nowrap; }
  .col-status  { width: 8%; }
  .col-loc     { width: 55%; text-align: justify; }
  @media print { button { display: none; } }
</style>
</head><body>
  <h2>${title}</h2>
  <p class="meta">Exported ${new Date().toLocaleString()}</p>
  <table><tbody>${sessionBlocks}</tbody></table>
  <br/><button onclick="window.print()">Print</button>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

// ── ClipRow ───────────────────────────────────────────────────────────────────

function ClipRow({ clip, canDelete, onClipDeleted }: { clip: PttClip; canDelete: boolean; onClipDeleted: (id: string) => void }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canPlay = clip.status === 'ready' && !!clip.filePath;

  async function doDelete() {
    await apiFetch(`/voice-recordings/${clip.id}`, { method: 'DELETE' });
    setConfirmDelete(false);
    onClipDeleted(clip.id);
  }
  const speakerName = clip.speakerLabel
    || `${clip.speakerFirstName ?? ''} ${clip.speakerLastName ?? ''}`.trim()
    || 'Unknown';

  // Inline quick play/stop on the row's button (matches the Recordings page).
  function toggleInlinePlay(e: React.MouseEvent) {
    e.stopPropagation();
    if (!canPlay) return;
    if (playing) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    const token = localStorage.getItem('accessToken');
    const url = `/api/voice-recordings/${clip.id}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const el = new Audio(url);
    el.onended = () => setPlaying(false);
    el.onerror = () => setPlaying(false);
    el.play().catch(() => setPlaying(false));
    audioRef.current = el;
    setPlaying(true);
  }

  // Clicking the row opens the waveform player modal (matches the Recordings page).
  function openPlayer() {
    if (!canPlay) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
    setShowPlayer(true);
  }

  return (
    <div
      className={`flex items-center gap-3 px-4 py-1.5 text-xs text-text-secondary hover:bg-white/3 ${canPlay ? 'cursor-pointer' : ''}`}
      onClick={openPlayer}
    >
      <button
        onClick={toggleInlinePlay}
        disabled={!canPlay}
        className="p-1 rounded bg-accent/20 text-accent disabled:opacity-30 cursor-pointer"
        title={playing ? 'Stop' : 'Play'}
      >
        {playing ? <Square size={10} /> : <Play size={10} />}
      </button>
      <span className="w-28 truncate">{speakerName}</span>
      <span className="w-36">{formatDateTime(clip.startedAt)}</span>
      <span className="w-16">{formatDuration(clip.durationSec)}</span>
      <span className={`w-20 text-[10px] uppercase font-medium px-1.5 py-0.5 rounded ${
        clip.status === 'ready' ? 'bg-success/20 text-success' :
        clip.status === 'recording' ? 'bg-danger/20 text-danger' :
        'bg-text-secondary/20 text-text-secondary'
      }`}>
        {clip.status}
      </span>
      <span className="w-36 shrink-0"><LocationCoords lat={clip.locationLat} lon={clip.locationLon} isDispatch={clip.isDispatch} /></span>
      <span className="flex-1 min-w-0"><LocationAddress lat={clip.locationLat} lon={clip.locationLon} isDispatch={clip.isDispatch} /></span>
      {canDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          className="shrink-0 p-1.5 text-text-secondary hover:text-danger rounded transition-colors"
          title="Delete clip"
        >
          <Trash2 size={12} />
        </button>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        title="Delete clip"
        message={`Delete this clip from ${speakerName}? The audio file will be permanently removed.`}
      />

      {showPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { e.stopPropagation(); setShowPlayer(false); }}>
          <div className="bg-bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">
                {speakerName} · {formatDateTime(clip.startedAt)}
              </h3>
              <button onClick={() => setShowPlayer(false)} className="text-text-secondary hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
            <WaveformPlayer rec={{ id: clip.id, filePath: clip.filePath, status: clip.status, durationSec: clip.durationSec }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── SessionRow ────────────────────────────────────────────────────────────────

function SessionRow({ session, canDelete, onDeleted }: { session: PttSession; canDelete: boolean; onDeleted: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiFetch(`/ptt-sessions/${session.id}`, { method: 'DELETE' });
      setConfirmOpen(false);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  }

  const [expanded, setExpanded] = useState(false);
  const [clips, setClips] = useState<PttClip[]>(session.clips ?? []);
  const [loadingClips, setLoadingClips] = useState(false);

  async function toggle() {
    if (!expanded && clips.length === 0) {
      setLoadingClips(true);
      try {
        const res = await apiFetch<{ clips: PttClip[] }>(`/ptt-sessions/${session.id}`);
        setClips(res.data?.clips ?? []);
      } catch { /* ignore */ } finally {
        setLoadingClips(false);
      }
    }
    setExpanded((e) => !e);
  }

  return (
    <>
      <tr className="border-b border-border hover:bg-white/3 cursor-pointer text-xs" onClick={toggle}>
        <td className="px-4 py-2.5 text-text-secondary">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </td>
        <td className="px-4 py-2.5">
          <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-medium px-1.5 py-0.5 rounded ${
            session.isPrivate ? 'bg-accent/20 text-accent' : 'bg-success/20 text-success'
          }`}>
            {session.isPrivate ? <Phone size={9} /> : <PhoneCall size={9} />}
            {session.isPrivate ? 'Private' : 'Group PTT'}
          </span>
        </td>
        <td className="px-4 py-2.5 text-white truncate max-w-[140px]">
          {session.channelName ?? (session.isPrivate ? 'Private Call' : '—')}
        </td>
        <td className="px-4 py-2.5">{formatDateTime(session.startedAt)}</td>
        <td className="px-4 py-2.5">
          {session.status === 'active' ? (
            <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-danger/20 text-danger">Active</span>
          ) : formatDuration(session.durationSec)}
        </td>
        <td className="px-4 py-2.5">{session.maxParticipantCount}</td>
        <td className="px-4 py-2.5">{session.clipCount}</td>
        {canDelete && (
          <td className="px-4 py-2.5 text-right">
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmOpen(true); }}
              className="p-1.5 text-text-secondary hover:text-danger rounded transition-colors"
              title="Delete this session, its clips and recordings"
            >
              <Trash2 size={13} />
            </button>
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-bg-sidebar/40">
          <td colSpan={canDelete ? 8 : 7} className="p-0">
            {loadingClips ? (
              <div className="px-4 py-2 text-xs text-text-secondary">Loading clips...</div>
            ) : clips.length === 0 ? (
              <div className="px-4 py-2 text-xs text-text-secondary">No clips recorded for this session.</div>
            ) : (
              <div className="py-1">
                <div className="flex items-center gap-3 px-4 py-1 text-[10px] text-text-secondary/60 uppercase font-medium border-b border-border/50">
                  <span className="w-6" />
                  <span className="w-28">Speaker</span>
                  <span className="w-36">Time</span>
                  <span className="w-16">Duration</span>
                  <span className="w-20">Status</span>
                  <span className="w-36">Location</span>
                  <span className="flex-1">Address</span>
                </div>
                {clips.map((clip) => (
                  <ClipRow
                    key={clip.id}
                    clip={clip}
                    canDelete={canDelete}
                    onClipDeleted={(id) => { setClips((prev) => prev.filter((c) => c.id !== id)); onDeleted(); }}
                  />
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete session"
        message={`Permanently delete this ${session.isPrivate ? 'private call' : 'group PTT'} session, its ${session.clipCount} clip(s) and recording files? This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
      />
    </>
  );
}

// ── Export dialog ─────────────────────────────────────────────────────────────

type ExportFormat = 'csv' | 'txt' | 'print' | 'share';

interface ExportDialogProps {
  format: ExportFormat;
  sessions: PttSession[];
  filename: string;
  onClose: () => void;
}

function ExportDialog({ format, sessions, filename, onClose }: ExportDialogProps) {
  const [loading, setLoading] = useState(false);

  async function handleExport(mode: 'summary' | 'details') {
    if (mode === 'summary') {
      const rows = toSummaryRows(sessions);
      if (format === 'csv') exportCsv(rows, SUMMARY_COLS, filename);
      else if (format === 'txt') exportTxt(rows, SUMMARY_COLS, filename);
      else if (format === 'print') printTable(rows, SUMMARY_COLS, 'Call Detail Records');
      else shareOrDownload(rows.map((r) => Object.values(r).join('\t')).join('\n'), filename);
      onClose();
      return;
    }

    // Details: fetch all clips in parallel
    setLoading(true);
    try {
      const withClips: SessionWithClips[] = await Promise.all(
        sessions.map(async (s) => {
          try {
            const res = await apiFetch<{ clips: PttClip[] }>(`/ptt-sessions/${s.id}`);
            return { ...s, clips: res.data?.clips ?? [] };
          } catch {
            return { ...s, clips: [] };
          }
        }),
      );

      if (format === 'csv') {
        const blob = new Blob([buildDetailsCsv(withClips)], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${filename}-details.csv`; a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'txt') {
        const blob = new Blob([buildDetailsTxt(withClips)], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${filename}-details.txt`; a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'print') {
        await printDetailsTable(withClips, 'Call Detail Records — Full');
      } else {
        shareOrDownload(buildDetailsTxt(withClips), `${filename}-details`);
      }
    } finally {
      setLoading(false);
      onClose();
    }
  }

  const formatLabel = format === 'csv' ? 'CSV' : format === 'txt' ? 'TXT' : format === 'print' ? 'Print/PDF' : 'Share';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-bg-card border border-border rounded-xl p-6 w-80 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Export — {formatLabel}</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-text-secondary mb-5">Choose what to include in the export:</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleExport('summary')}
            disabled={loading}
            className="w-full text-left px-4 py-3 rounded-lg border border-border bg-bg-primary hover:border-accent/50 hover:bg-accent/5 transition-colors"
          >
            <p className="text-sm font-medium text-white">Summary</p>
            <p className="text-xs text-text-secondary mt-0.5">Session list only — Type, Channel, Started, Duration, Participants, Clips</p>
          </button>
          <button
            onClick={() => handleExport('details')}
            disabled={loading}
            className="w-full text-left px-4 py-3 rounded-lg border border-border bg-bg-primary hover:border-accent/50 hover:bg-accent/5 transition-colors disabled:opacity-50"
          >
            <p className="text-sm font-medium text-white flex items-center gap-2">
              With Details
              {loading && <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin inline-block" />}
            </p>
            <p className="text-xs text-text-secondary mt-0.5">Sessions + per-speaker clips with location coordinates</p>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CdrPage ───────────────────────────────────────────────────────────────────

export function CdrPage() {
  const [page, setPage] = useState(1);
  const [channelId, setChannelId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);

  const { sessions, pagination, loading, error, refetch } = useCdr({
    page,
    limit: 25,
    channelId,
    from: from ? new Date(from).toISOString() : '',
    to: to ? new Date(to + 'T23:59:59').toISOString() : '',
  });
  const canDelete = getJwtRoleLevel() >= ADMIN_LEVEL;
  const [view, setView] = useState<'calls' | 'clips'>('calls');

  useEffect(() => { setPage(1); }, [channelId, from, to]);

  useEffect(() => {
    apiFetch<{ id: string; name: string }[]>('/voice-channels')
      .then((res: any) => setChannels(res.data || []))
      .catch(() => {});
  }, []);

  function resetFilters() { setChannelId(''); setFrom(''); setTo(''); setPage(1); }

  const filename = `cdr-${new Date().toISOString().slice(0, 10)}`;

  return (
    <div>
      {exportFormat && (
        <ExportDialog
          format={exportFormat}
          sessions={sessions}
          filename={filename}
          onClose={() => setExportFormat(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Call Detail Records</h1>
          <p className="text-sm text-text-secondary mt-1">
            {view === 'calls' ? 'PTT session history and per-speaker clip playback' : 'All recorded clips — play, download, and manage'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-bg-card rounded-lg p-1 border border-border">
            <button
              onClick={() => setView('calls')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'calls' ? 'bg-accent text-white' : 'text-text-secondary hover:text-white'}`}
            >
              Calls
            </button>
            <button
              onClick={() => setView('clips')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'clips' ? 'bg-accent text-white' : 'text-text-secondary hover:text-white'}`}
            >
              Clips
            </button>
          </div>
          {view === 'calls' && (
            <Button variant="ghost" size="sm" onClick={refetch}>
              <RotateCcw size={14} className="mr-1.5" />
              Refresh
            </Button>
          )}
        </div>
      </div>

      {view === 'clips' && <ClipsView />}

      {view === 'calls' && (
       <>
      {/* Filters */}
      <div className="bg-bg-card border border-border rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase font-medium">Channel</label>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="rounded bg-bg-primary border border-border px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent min-w-[160px]"
          >
            <option value="">All channels</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase font-medium">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded bg-bg-primary border border-border px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary uppercase font-medium">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded bg-bg-primary border border-border px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
        <Button variant="ghost" size="sm" onClick={resetFilters} className="self-end">
          <RotateCcw size={13} className="mr-1.5" />
          Reset
        </Button>
      </div>

      {/* Export bar */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-text-secondary mr-1">Export:</span>
          <Button variant="ghost" size="sm" onClick={() => setExportFormat('print')}>
            <Printer size={13} className="mr-1.5" /> Print/PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExportFormat('csv')}>
            <Download size={13} className="mr-1.5" /> CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExportFormat('txt')}>
            <FileText size={13} className="mr-1.5" /> TXT
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExportFormat('share')}>
            <Share2 size={13} className="mr-1.5" /> Share
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <p className="text-center text-danger py-12 text-sm">{error}</p>
        ) : sessions.length === 0 ? (
          <p className="text-center text-text-secondary py-12 text-sm">No PTT sessions found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-sidebar/40">
                <th className="px-4 py-3 w-8" />
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Channel</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Started</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Participants</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Clips</th>
                {canDelete && <th className="px-4 py-3 w-10" />}
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => <SessionRow key={session.id} session={session} canDelete={canDelete} onDeleted={refetch} />)}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            onPageChange={setPage}
          />
        </div>
      )}
       </>
      )}
    </div>
  );
}
