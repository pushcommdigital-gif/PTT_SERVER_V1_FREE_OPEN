import { useEffect, useRef, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Play, Pause, SkipBack, Route, ChevronRight } from 'lucide-react';
import { useTrackReplay, type PlaybackSpeed } from '../../hooks/useTrackReplay';
import { useUsers } from '../../hooks/useUsers';

const USER_COLORS = ['#e67e22', '#3b82f6', '#10b981', '#a855f7', '#f43f5e', '#06b6d4'];
function userColor(idx: number) { return USER_COLORS[idx % USER_COLORS.length]; }

// Draw the raw GPS trail honestly: drop low-accuracy fixes, and split the line
// wherever a time gap or an implausible distance
// jump implies missing/invalid data — so we never draw a straight chord through
// buildings to bridge a hole. Returns segments for a MultiLineString.
const FALLBACK_MAX_ACC_M = 50;
const FALLBACK_GAP_MS = 90_000;   // >90 s between fixes = a gap, don't bridge it
const FALLBACK_JUMP_M = 300;      // >300 m step = a jump (bad fix / missing data)
function haversineM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const R = 6371000, d2r = Math.PI / 180;
  const dLat = (bLat - aLat) * d2r, dLon = (bLon - aLon) * d2r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * d2r) * Math.cos(bLat * d2r) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function fallbackSegments(points: { lon: number; lat: number; ts: string; accuracy: number | null }[]): [number, number][][] {
  const clean = points.filter((p) => p.accuracy == null || p.accuracy <= FALLBACK_MAX_ACC_M);
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < clean.length; i++) {
    const p = clean[i];
    if (i > 0) {
      const prev = clean[i - 1];
      const dt = new Date(p.ts).getTime() - new Date(prev.ts).getTime();
      const dm = haversineM(prev.lon, prev.lat, p.lon, p.lat);
      if (dt > FALLBACK_GAP_MS || dm > FALLBACK_JUMP_M) { if (cur.length >= 2) segs.push(cur); cur = []; }
    }
    cur.push([p.lon, p.lat]);
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function formatTime(ms: number) {
  if (!ms || ms < 0) return '0:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function UserSelector({
  allUsers,
  selected,
  onChange,
}: {
  allUsers: { id: string; firstName: string; lastName: string }[];
  selected: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  }
  const label = selected.size === 0
    ? 'Select users…'
    : selected.size === 1
      ? (() => { const u = allUsers.find((u) => selected.has(u.id)); return u ? `${u.firstName} ${u.lastName}` : '1 user'; })()
      : `${selected.size} users`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 bg-bg-primary border border-border rounded text-xs text-white hover:border-accent transition-colors min-w-32"
      >
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-52 bg-bg-card border border-border rounded-lg shadow-2xl max-h-56 overflow-y-auto">
          {allUsers.map((u) => (
            <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer">
              <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} className="accent-accent" />
              <span className="text-xs text-white">{u.firstName} {u.lastName}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function TrackReplayPanel() {
  const replay = useTrackReplay();
  const { users: allUsers } = useUsers({ page: 1, limit: 200, search: '', role: 'all' });

  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [fromStr, setFromStr] = useState(() => {
    const d = new Date(); d.setHours(d.getHours() - 4); return d.toISOString().slice(0, 16);
  });
  const [toStr, setToStr] = useState(() => new Date().toISOString().slice(0, 16));

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Record<string, maplibregl.Marker>>({});

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [-80.1918, 25.7617],
      zoom: 11,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Draw full tracks when data loads
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    replay.tracks.forEach((_, i) => {
      const id = `track-${i}`;
      const playedId = `track-played-${i}`;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      if (map.getLayer(playedId)) map.removeLayer(playedId);
      if (map.getSource(playedId)) map.removeSource(playedId);
    });

    replay.tracks.forEach((track, i) => {
      if (track.points.length < 2) return;
      const color = userColor(i);
      const id = `track-${i}`;
      // CLEANED raw fixes, split across gaps/jumps so we don't draw through buildings.
      map.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: fallbackSegments(track.points) } } });
      map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.3 } });
      const playedId = `track-played-${i}`;
      map.addSource(playedId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
      map.addLayer({ id: playedId, type: 'line', source: playedId, paint: { 'line-color': color, 'line-width': 4, 'line-opacity': 0.9 } });
    });

    const allPts = replay.tracks.flatMap((t) => t.points);
    if (allPts.length > 0) {
      const bounds = allPts.reduce(
        (b, p) => b.extend([p.lon, p.lat] as [number, number]),
        new maplibregl.LngLatBounds([allPts[0].lon, allPts[0].lat], [allPts[0].lon, allPts[0].lat]),
      );
      map.fitBounds(bounds, { padding: 40, maxZoom: 16 });
    }

    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    replay.tracks.forEach((track, i) => {
      if (track.points.length === 0) return;
      const color = userColor(i);
      const el = document.createElement('div');
      el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;box-shadow:0 2px 6px rgba(0,0,0,.5);`;
      // Initials (first letter of each word) — "User One" → "UO", not "US".
      el.textContent = track.displayName.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      markersRef.current[track.userId] = new maplibregl.Marker({ element: el })
        .setLngLat([track.points[0].lon, track.points[0].lat])
        .addTo(map);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay.tracks]);

  // Update markers + played line during replay
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    replay.tracks.forEach((track, i) => {
      const marker = markersRef.current[track.userId];
      const playedId = `track-played-${i}`;
      if (!map.getSource(playedId)) return;
      const absMs = replay.windowFrom ? replay.windowFrom.getTime() + replay.replayMs : 0;

      // Time-interpolated marker + the trail travelled so far.
      const pos = replay.currentPositions[track.userId];
      if (pos && marker) marker.setLngLat([pos.lon, pos.lat]);
      const playedPts = track.points.filter((p) => new Date(p.ts).getTime() <= absMs);
      const coords = pos ? [...playedPts.map((p) => [p.lon, p.lat]), [pos.lon, pos.lat]] : playedPts.map((p) => [p.lon, p.lat]);
      (map.getSource(playedId) as maplibregl.GeoJSONSource)?.setData({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      });
    });
  }, [replay.replayMs, replay.currentPositions, replay.tracks, replay.windowFrom]);

  const handleLoad = useCallback(() => {
    if (selectedUserIds.size === 0) return;
    replay.load([...selectedUserIds], new Date(fromStr), new Date(toStr));
  }, [selectedUserIds, fromStr, toStr, replay]);

  const hasData = replay.tracks.length > 0;
  const totalMs = replay.totalDurationMs;

  return (
    <div className="flex flex-col h-full">
      {/* Native datetime picker glyph is dark-on-dark → replace it with an orange calendar. */}
      <style>{`
        .tr-date::-webkit-calendar-picker-indicator {
          cursor: pointer;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23e67e22' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2'/%3E%3Cline x1='16' y1='2' x2='16' y2='6'/%3E%3Cline x1='8' y1='2' x2='8' y2='6'/%3E%3Cline x1='3' y1='10' x2='21' y2='10'/%3E%3C/svg%3E");
        }
      `}</style>
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-card flex-wrap flex-shrink-0">
        <Route size={14} className="text-accent flex-shrink-0" />
        <UserSelector allUsers={allUsers} selected={selectedUserIds} onChange={setSelectedUserIds} />
        <input
          type="datetime-local"
          value={fromStr}
          onChange={(e) => setFromStr(e.target.value)}
          className="tr-date bg-bg-primary border border-border rounded px-2 py-1 text-xs text-white focus:border-accent focus:outline-none"
        />
        <span className="text-text-secondary text-xs">→</span>
        <input
          type="datetime-local"
          value={toStr}
          onChange={(e) => setToStr(e.target.value)}
          className="tr-date bg-bg-primary border border-border rounded px-2 py-1 text-xs text-white focus:border-accent focus:outline-none"
        />
        <button
          onClick={handleLoad}
          disabled={selectedUserIds.size === 0 || replay.loading}
          className="px-3 py-1 bg-accent hover:bg-accent/80 text-white rounded text-xs font-medium disabled:opacity-40 transition-colors"
        >
          {replay.loading ? 'Loading…' : 'Load'}
        </button>
        {replay.error && <span className="text-danger text-xs">{replay.error}</span>}
        {hasData && (
          <div className="ml-auto flex items-center gap-2">
            {replay.tracks.map((t, i) => (
              <span key={t.userId} className="flex items-center gap-1 text-xs text-text-secondary">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: userColor(i) }} />
                {t.displayName}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative min-h-0">
        <div ref={mapContainerRef} className="w-full h-full" />
        {!hasData && !replay.loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <Route size={36} className="text-text-secondary/20 mb-2" />
            <p className="text-text-secondary text-xs">Select users and a time range, then Load</p>
          </div>
        )}
      </div>

      {/* Timeline */}
      {hasData && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-bg-card flex-shrink-0">
          <button onClick={() => replay.seekTo(0)} className="p-1 text-text-secondary hover:text-white rounded transition-colors" title="Rewind">
            <SkipBack size={13} />
          </button>
          <button
            onClick={replay.togglePlay}
            className="w-6 h-6 rounded-full bg-accent hover:bg-accent/80 flex items-center justify-center text-white transition-colors flex-shrink-0"
          >
            {replay.isPlaying ? <Pause size={11} /> : <Play size={11} className="ml-0.5" />}
          </button>
          <span className="text-xs font-mono text-white flex-shrink-0">
            {formatTime(replay.replayMs)} <span className="text-text-secondary">/ {formatTime(totalMs)}</span>
          </span>
          <div className="flex-1 relative">
            <input
              type="range" min={0} max={totalMs} value={replay.replayMs}
              onChange={(e) => replay.seekTo(parseInt(e.target.value, 10))}
              className="w-full accent-accent h-1.5 cursor-pointer"
              style={{ position: 'relative', zIndex: 20 }}
            />
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {([1, 2, 4, 8] as PlaybackSpeed[]).map((s) => (
              <button
                key={s}
                onClick={() => replay.setSpeed(s)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${replay.speed === s ? 'bg-accent text-white' : 'text-text-secondary hover:text-white'}`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
