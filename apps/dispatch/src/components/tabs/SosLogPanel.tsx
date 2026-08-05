import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, MapPin, Radio, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useWsEvent } from '../../contexts/WebSocketContext';
import { SOS_DISPOSITIONS } from '@pushcomm/shared';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface SosEntry {
  id: string;
  reportedById: string;
  firstName: string;
  lastName: string;
  latitude: string | null;
  longitude: string | null;
  status: string;
  acknowledgedAt: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  ackFirstName: string | null;
  ackLastName: string | null;
  resolveFirstName: string | null;
  resolveLastName: string | null;
}

export interface SosLogPanelProps {
  onTalkToUnit?: (userId: string, name: string) => void;
  onRecenter?: (lat: number, lon: number) => void;
}

const STATUS_ORDER: Record<string, number> = { active: 0, acknowledged: 1, resolved: 2, cancelled: 3 };
const dispositionLabel = (v: string | null) => SOS_DISPOSITIONS.find((d) => d.value === v)?.label ?? v ?? '';

function todayStr(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function msUntilMidnight(): number {
  const m = new Date();
  m.setDate(m.getDate() + 1);
  m.setHours(0, 0, 0, 0);
  return m.getTime() - Date.now();
}
function fixAge(createdAt: string): { label: string; cls: string } {
  const mins = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (mins < 3) return { label: 'GPS fresh', cls: 'text-emerald-400' };
  if (mins < 10) return { label: `GPS ${Math.floor(mins)}m old`, cls: 'text-amber-400' };
  return { label: `GPS ${Math.floor(mins)}m old`, cls: 'text-danger' };
}

// Dispatcher response time: trigger → first acknowledgement.
function responseTime(createdAt: string, acknowledgedAt: string | null): string | null {
  if (!acknowledgedAt) return null;
  const ms = new Date(acknowledgedAt).getTime() - new Date(createdAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function fetchAddress(lat: string, lon: string): Promise<string | null> {
  try {
    const res = await apiFetch<Array<{ address: string }>>(`/geocoding/reverse?lat=${lat}&lng=${lon}`);
    return res.data?.[0]?.address ?? null;
  } catch {
    return null;
  }
}

export function SosLogPanel({ onTalkToUnit, onRecenter }: SosLogPanelProps = {}) {
  const [entries, setEntries] = useState<SosEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [day, setDay] = useState(todayStr);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [resolveTarget, setResolveTarget] = useState<SosEntry | null>(null);
  const lookingUp = useRef<Set<string>>(new Set());

  const lookupAddress = useCallback((entry: SosEntry) => {
    if (!entry.latitude || !entry.longitude || lookingUp.current.has(entry.id)) return;
    lookingUp.current.add(entry.id);
    fetchAddress(entry.latitude, entry.longitude).then((addr) => {
      if (addr) setAddresses((prev) => ({ ...prev, [entry.id]: addr }));
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Today + any still-open (active/acknowledged) regardless of date.
      const res = await apiFetch<SosEntry[]>(`/sos?all=true&from=${day}&to=${day}&includeOpen=true`);
      const data = res.data ?? [];
      setEntries(data);
      data.forEach(lookupAddress);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [day, lookupAddress]);

  useEffect(() => { load(); }, [load]);

  // Midnight rollover — reset the day + dismissed set.
  useEffect(() => {
    const t = setTimeout(() => { setDay(todayStr()); setDismissed(new Set()); }, msUntilMidnight());
    return () => clearTimeout(t);
  }, [day]);

  const upsertEntry = useCallback((partial: SosEntry) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === partial.id);
      if (idx === -1) return [partial, ...prev].slice(0, 200);
      const next = [...prev];
      next[idx] = { ...next[idx], ...partial };
      return next;
    });
    lookupAddress(partial);
  }, [lookupAddress]);

  useWsEvent('sos:triggered', (e: any) => {
    upsertEntry({
      id: e.sosId, reportedById: e.userId ?? '', firstName: e.firstName ?? '', lastName: e.lastName ?? '',
      latitude: e.latitude != null ? String(e.latitude) : null,
      longitude: e.longitude != null ? String(e.longitude) : null,
      status: 'active', acknowledgedAt: null, resolution: null, resolutionNote: null, resolvedAt: null,
      createdAt: e.timestamp ?? new Date().toISOString(),
      ackFirstName: null, ackLastName: null, resolveFirstName: null, resolveLastName: null,
    });
  });
  useWsEvent('sos:acknowledged', (e: any) => {
    setEntries((prev) => prev.map((x) => x.id === e.sosId ? { ...x, status: 'acknowledged', acknowledgedAt: e.timestamp ?? new Date().toISOString() } : x));
  });
  useWsEvent('sos:resolved', (e: any) => {
    setEntries((prev) => prev.map((x) => x.id === e.sosId ? { ...x, status: 'resolved', resolution: e.disposition, resolvedAt: e.timestamp ?? new Date().toISOString() } : x));
  });
  useWsEvent('sos:cancelled', (e: any) => {
    setEntries((prev) => prev.map((x) => x.id === e.sosId ? { ...x, status: 'cancelled' } : x));
  });

  async function acknowledge(id: string) {
    try { await apiFetch(`/sos/${id}/acknowledge`, { method: 'POST' }); } catch { /* ignore */ }
  }

  const visible = entries
    .filter((e) => !dismissed.has(e.id))
    .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  const activeCount = entries.filter((e) => e.status === 'active' || e.status === 'acknowledged').length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-text-secondary">Today · {day}</span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Stat label="Shown" value={visible.length} />
          <Stat label="Active" value={activeCount} highlight={activeCount > 0} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
        ) : visible.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-6">No SOS events today.</p>
        ) : (
          visible.map((entry) => {
            const name = `${entry.firstName} ${entry.lastName}`.trim() || 'Unknown';
            const isActive = entry.status === 'active';
            const isAck = entry.status === 'acknowledged';
            const isOpen = isActive || isAck;
            const lat = entry.latitude ? parseFloat(entry.latitude) : null;
            const lon = entry.longitude ? parseFloat(entry.longitude) : null;
            const coords = lat != null && lon != null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : null;
            const address = addresses[entry.id] ?? null;
            const ackName = entry.ackFirstName ? `${entry.ackFirstName} ${entry.ackLastName ?? ''}`.trim() : null;
            const resName = entry.resolveFirstName ? `${entry.resolveFirstName} ${entry.resolveLastName ?? ''}`.trim() : null;
            const age = fixAge(entry.createdAt);
            const statusCls = isActive ? 'bg-danger/20 text-danger'
              : isAck ? 'bg-amber-500/20 text-amber-400'
              : entry.status === 'resolved' ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-gray-500/20 text-gray-400';

            return (
              <div key={entry.id} className={`bg-bg-card border rounded-lg p-2 ${isActive ? 'border-danger/60' : isAck ? 'border-amber-500/50' : 'border-border'}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {isActive ? <AlertTriangle size={11} className="text-danger shrink-0" />
                    : isAck ? <Clock size={11} className="text-amber-400 shrink-0" />
                    : <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                  <span className={`text-xs font-semibold ${isActive ? 'text-danger' : 'text-white'}`}>{name}</span>
                  <span className={`ml-auto text-[10px] uppercase font-medium px-1.5 py-0.5 rounded ${statusCls}`}>
                    {entry.status}
                  </span>
                  <button
                    onClick={() => !isOpen && setDismissed((p) => new Set([...p, entry.id]))}
                    disabled={isOpen}
                    className="text-text-secondary/50 hover:text-text-secondary disabled:opacity-20 disabled:cursor-not-allowed ml-1 shrink-0"
                    title={isOpen ? 'Resolve or cancel before dismissing' : 'Dismiss from list'}
                  >
                    <X size={11} />
                  </button>
                </div>

                {(address || coords) && (
                  <div className="flex items-start gap-1 text-[10px] text-text-secondary mb-1">
                    <MapPin size={9} className="mt-0.5 shrink-0" />
                    <span>
                      {address ?? coords}{address && coords && <span className="text-text-secondary/60 ml-1">({coords})</span>}
                      {coords && <span className={`ml-1 ${age.cls}`}>· {age.label}</span>}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-secondary">
                  <span className="flex items-center gap-1"><Clock size={9} />{new Date(entry.createdAt).toLocaleTimeString()}</span>
                  {entry.acknowledgedAt && (
                    <span>
                      Ack{(() => { const rt = responseTime(entry.createdAt, entry.acknowledgedAt); return rt ? <span className="text-info font-medium"> in {rt}</span> : null; })()}{ackName ? ` · ${ackName}` : ''}
                    </span>
                  )}
                  {entry.resolvedAt && <span className="text-emerald-400/90">Resolved{resName ? ` · ${resName}` : ''}: {dispositionLabel(entry.resolution)}</span>}
                </div>
                {entry.resolution === 'other' && entry.resolutionNote && (
                  <p className="text-[10px] text-text-secondary/80 mt-0.5 italic">“{entry.resolutionNote}”</p>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  {lat != null && lon != null && (
                    <ActionBtn icon={MapPin} label="Locate" onClick={() => onRecenter?.(lat, lon)} />
                  )}
                  {entry.reportedById && <ActionBtn icon={Radio} label="Talk" onClick={() => onTalkToUnit?.(entry.reportedById, name)} />}
                  {isActive && <ActionBtn icon={CheckCircle2} label="Ack" onClick={() => acknowledge(entry.id)} />}
                  {isOpen && <ActionBtn icon={CheckCircle2} label="Resolve" accent onClick={() => setResolveTarget(entry)} />}
                </div>
              </div>
            );
          })
        )}
      </div>

      {resolveTarget && (
        <ResolveModal
          entry={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={() => { setResolveTarget(null); }}
        />
      )}
    </div>
  );
}

function ResolveModal({ entry, onClose, onResolved }: { entry: SosEntry; onClose: () => void; onResolved: () => void }) {
  const [disposition, setDisposition] = useState(SOS_DISPOSITIONS[0].value);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (disposition === 'other' && !note.trim()) { setError('A note is required for "Other".'); return; }
    setSaving(true); setError(null);
    try {
      await apiFetch(`/sos/${entry.id}/resolve`, { method: 'POST', body: JSON.stringify({ disposition, note: note.trim() || undefined }) });
      onResolved();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to resolve'); setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Resolve SOS" maxWidth="max-w-sm">
      <div className="space-y-3">
        <Select label="Disposition" value={disposition} onChange={(e) => setDisposition(e.target.value)}
          options={SOS_DISPOSITIONS.map((d) => ({ value: d.value, label: d.label }))} />
        <Input label={`Note${disposition === 'other' ? ' (required)' : ' (optional)'}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Details…" />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={saving}>Resolve</Button>
        </div>
      </div>
    </Modal>
  );
}

function ActionBtn({ icon: Icon, label, onClick, accent }: { icon: any; label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer border ${
        accent ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10' : 'border-border text-text-secondary hover:text-white hover:border-border/70'
      }`}
    >
      <Icon size={10} />{label}
    </button>
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
