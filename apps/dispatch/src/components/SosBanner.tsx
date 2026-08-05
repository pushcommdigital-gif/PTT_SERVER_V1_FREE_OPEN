import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, MapPin } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useWsEvent } from '../contexts/WebSocketContext';

interface SosAlert {
  id: string;
  firstName: string;
  lastName: string;
  latitude: string | null;
  longitude: string | null;
  createdAt: string;
}

// ── Web Audio alarm — no external file needed ──────────────────────────────
let audioCtx: AudioContext | null = null;
let alarmOscillator: OscillatorNode | null = null;
let alarmGain: GainNode | null = null;
let alarmTimer: ReturnType<typeof setInterval> | null = null;

function startAlarm() {
  if (alarmOscillator) return; // already running
  try {
    audioCtx = audioCtx ?? new AudioContext();
    alarmGain = audioCtx.createGain();
    alarmGain.gain.value = 0.4;
    alarmGain.connect(audioCtx.destination);

    let on = true;
    alarmTimer = setInterval(() => {
      if (!audioCtx || !alarmGain) return;
      if (alarmOscillator) { alarmOscillator.stop(); alarmOscillator = null; }
      if (on) {
        alarmOscillator = audioCtx.createOscillator();
        alarmOscillator.type = 'square';
        alarmOscillator.frequency.value = 880;
        alarmOscillator.connect(alarmGain);
        alarmOscillator.start();
      }
      on = !on;
    }, 400);
  } catch {
    // AudioContext not available (e.g. SSR/test)
  }
}

function stopAlarm() {
  if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
  if (alarmOscillator) { try { alarmOscillator.stop(); } catch { /* ignore */ } alarmOscillator = null; }
}

// ──────────────────────────────────────────────────────────────────────────

export function SosBanner() {
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const pulseRef = useRef(false);
  const [pulse, setPulse] = useState(false);

  // The banner is the urgent strip for UNACKNOWLEDGED emergencies only. Once
  // acknowledged, an SOS leaves the banner and lives in the SOS Alerts panel
  // (still counted Active there) until it is resolved.
  useEffect(() => {
    if (alerts.length === 0) return;
    const id = setInterval(() => {
      pulseRef.current = !pulseRef.current;
      setPulse(pulseRef.current);
    }, 500);
    return () => clearInterval(id);
  }, [alerts.length]);

  // Load active (unacknowledged) SOS on mount — GET /sos defaults to active only.
  useEffect(() => {
    apiFetch<SosAlert[]>('/sos')
      .then((res) => setAlerts(res.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (alerts.length > 0) startAlarm();
    else stopAlarm();
    return () => { if (alerts.length === 0) stopAlarm(); };
  }, [alerts.length]);

  const upsertAlert = useCallback((alert: SosAlert) => {
    setAlerts((prev) => {
      const idx = prev.findIndex((a) => a.id === alert.id);
      if (idx === -1) return [alert, ...prev];
      const next = [...prev];
      next[idx] = alert;
      return next;
    });
  }, []);

  useWsEvent('sos:triggered', (e: any) => {
    upsertAlert({
      id: e.sosId,
      firstName: e.firstName ?? '',
      lastName: e.lastName ?? '',
      latitude: e.latitude ?? null,
      longitude: e.longitude ?? null,
      createdAt: e.timestamp ?? new Date().toISOString(),
    });
  });
  // Acknowledge / resolve / cancel all remove it from the banner.
  useWsEvent('sos:acknowledged', (e: any) => setAlerts((prev) => prev.filter((a) => a.id !== e.sosId)));
  useWsEvent('sos:resolved', (e: any) => setAlerts((prev) => prev.filter((a) => a.id !== e.sosId)));
  useWsEvent('sos:cancelled', (e: any) => setAlerts((prev) => prev.filter((a) => a.id !== e.sosId)));

  async function acknowledge(id: string) {
    try {
      await apiFetch(`/sos/${id}/acknowledge`, { method: 'POST' });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch { /* ignore */ }
  }

  if (alerts.length === 0) return null;

  const bgColor = pulse ? 'bg-red-700' : 'bg-red-600';

  return (
    <div className={`${bgColor} transition-colors duration-200 z-50 shrink-0 max-h-[40vh] overflow-y-auto`}>
      {alerts.length > 1 && (
        <div className="px-4 py-1 text-white text-xs font-bold uppercase tracking-wide border-b border-white/20 sticky top-0 bg-inherit">
          {alerts.length} active emergencies
        </div>
      )}
      {alerts.map((alert) => {
        const name = `${alert.firstName} ${alert.lastName}`.trim() || 'Unknown';
        const time = new Date(alert.createdAt).toLocaleTimeString();
        const coords =
          alert.latitude && alert.longitude
            ? `${parseFloat(alert.latitude).toFixed(5)}, ${parseFloat(alert.longitude).toFixed(5)}`
            : null;

        return (
          <div key={alert.id} className="flex items-center gap-3 px-4 py-2 border-b border-red-500/40 last:border-b-0">
            <AlertTriangle size={18} className="text-white shrink-0 animate-pulse" />
            <span className="text-white font-bold text-sm uppercase tracking-wide shrink-0">SOS</span>
            <span className="text-white font-semibold text-sm">{name}</span>
            {coords && (
              <span className="flex items-center gap-1 text-red-100 text-xs">
                <MapPin size={11} />
                {coords}
              </span>
            )}
            <span className="text-red-200 text-xs ml-auto shrink-0">{time}</span>
            <button
              onClick={() => acknowledge(alert.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white/20 hover:bg-white/30 text-white text-xs font-semibold shrink-0 cursor-pointer"
            >
              <CheckCircle2 size={12} />
              Acknowledge
            </button>
          </div>
        );
      })}
    </div>
  );
}
