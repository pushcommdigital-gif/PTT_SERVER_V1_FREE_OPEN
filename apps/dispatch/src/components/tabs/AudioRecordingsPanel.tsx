import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { ChevronLeft, ChevronRight, Headphones, Play, Search, Square } from 'lucide-react';
import { useLayout } from '../../contexts/LayoutContext';

interface VoiceRecording {
  id: string;
  channelId: string | null;
  callId: string | null;
  direction: string;
  status: string;
  speakerLabel: string | null;
  fileSize: number | null;
  durationSec: number | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  channelName: string | null;
  callNumber: number | null;
  callName: string | null;
  speakerFirstName: string | null;
  speakerLastName: string | null;
  filePath: string | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type StatusFilter = 'all' | 'recording' | 'processing' | 'ready' | 'failed';

const PAGE_SIZE = 10;

function formatSize(bytes: number | null) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec: number | null) {
  if (!sec || sec <= 0) return '-';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AudioRecordingsPanel() {
  const { updatePanel } = useLayout();
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const paginationRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [items, setItems] = useState<VoiceRecording[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  async function fetchRecordings(p: number) {
    const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
    if (search.trim()) params.set('search', search.trim());
    if (status !== 'all') params.set('status', status);

    try {
      const res = await apiFetch<VoiceRecording[]>(`/voice-recordings?${params.toString()}`);
      setItems(res.data || []);
      if (res.pagination) setPagination(res.pagination as unknown as Pagination);
    } catch {
      setItems([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
    setLoading(true);
    fetchRecordings(1);
  }, [search, status]);

  useEffect(() => {
    setLoading(true);
    fetchRecordings(page);
  }, [page]);

  // Auto-refresh every 30s (only current page)
  useEffect(() => {
    const id = setInterval(() => fetchRecordings(page), 30_000);
    return () => clearInterval(id);
  }, [page, search, status]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [items],
  );

  const totalPages = pagination?.totalPages ?? 1;
  const total = pagination?.total ?? items.length;

  // Auto-resize panel height to fit content (must be after sorted/totalPages)
  useEffect(() => {
    requestAnimationFrame(() => {
      const headerH = headerRef.current?.offsetHeight ?? 0;
      const gridH = gridRef.current?.scrollHeight ?? 0;
      const paginationH = paginationRef.current?.offsetHeight ?? 0;
      const TITLE_BAR = 40;
      const PADDING = 16;
      const needed = TITLE_BAR + headerH + PADDING + gridH + paginationH + 8;
      updatePanel('voiceRec', { h: Math.max(300, Math.min(needed, 850)) });
    });
  }, [sorted.length, totalPages]);

  async function handlePlay(item: VoiceRecording) {
    if (!item.filePath) return;

    if (playingId === item.id) {
      audioEl?.pause();
      setPlayingId(null);
      return;
    }

    audioEl?.pause();

    try {
      const token = localStorage.getItem('accessToken');
      const url = `/api/voice-recordings/${item.id}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const el = new Audio(url);
      el.onended = () => setPlayingId(null);
      await el.play();
      setAudioEl(el);
      setPlayingId(item.id);
    } catch {
      setPlayingId(null);
    }
  }

  return (
    <div className="w-full h-full bg-bg-sidebar flex flex-col">
      {/* Header / filters */}
      <div ref={headerRef} className="px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Headphones size={14} className="text-accent" />
          <span className="text-sm font-semibold">Live Audio Logs</span>
          <span className="text-xs text-text-secondary bg-bg-primary rounded-full px-1.5 py-0.5">
            {total}
          </span>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-2 text-text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-bg-primary border border-border rounded pl-7 pr-2 py-1.5 text-xs text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Search by speaker or note..."
            />
          </div>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded bg-bg-primary border border-border px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="all">All statuses</option>
            <option value="recording">Live (recording)</option>
            <option value="ready">Ready</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Cards grid */}
      <div className="flex-1 overflow-hidden p-2" ref={gridRef}>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-6">
            No live radio recordings yet.
          </p>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {sorted.map((item) => {
              const speakerName = item.speakerLabel
                || `${item.speakerFirstName || ''} ${item.speakerLastName || ''}`.trim()
                || 'Unknown speaker';

              return (
                <div key={item.id} className="bg-bg-card border border-border rounded-lg p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium truncate">{speakerName}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.status === 'recording' && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-danger/20 text-danger animate-pulse">
                          LIVE
                        </span>
                      )}
                      <button
                        onClick={() => handlePlay(item)}
                        disabled={!item.filePath || item.status !== 'ready'}
                        className={`p-1.5 rounded ${
                          playingId === item.id
                            ? 'bg-danger/20 text-danger'
                            : 'bg-accent/20 text-accent'
                        } disabled:opacity-40 cursor-pointer`}
                        title={item.filePath ? 'Play recording' : 'Recording file not available'}
                      >
                        {playingId === item.id ? <Square size={12} /> : <Play size={12} />}
                      </button>
                    </div>
                  </div>

                  <div className="mt-1 text-[10px] text-text-secondary space-y-0.5">
                    <p className="truncate">Channel: {item.channelName || 'Unknown'}</p>
                    <p>Recorded: {new Date(item.startedAt).toLocaleDateString()}</p>
                  </div>

                  <div className="mt-1 text-[10px] text-text-secondary flex items-center justify-between">
                    <span className="uppercase">{item.direction.replaceAll('_', ' ')}</span>
                    <span>{formatDuration(item.durationSec)} / {formatSize(item.fileSize)}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-text-secondary/80 flex items-center justify-between">
                    <span>Status: {item.status}</span>
                    <span>{new Date(item.startedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div ref={paginationRef} className="px-3 py-2 border-t border-border shrink-0 flex items-center justify-between">
          <span className="text-xs text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded hover:bg-bg-card disabled:opacity-40 text-text-secondary"
            >
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const p = start + i;
              if (p > totalPages) return null;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-6 h-6 text-xs rounded ${
                    p === page
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:bg-bg-card'
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded hover:bg-bg-card disabled:opacity-40 text-text-secondary"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
