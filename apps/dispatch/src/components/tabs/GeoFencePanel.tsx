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
import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldOff,
  Trash2,
  Users,
  X,
} from 'lucide-react';

interface DeptUser { id: string; firstName: string; lastName: string; username: string; }
import { apiFetch } from '../../lib/api';
import { useLayout } from '../../contexts/LayoutContext';
import { useWsEvent } from '../../contexts/WebSocketContext';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { GeoFence, PointOfInterest } from '../../contexts/LayoutContext';

/** Compute centroid of a [lon, lat][] polygon */
function polygonCentroid(coords: [number, number][]): { lat: number; lon: number } {
  const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return { lat, lon };
}

type Tab = 'fences' | 'pois';
type DeleteTarget = { kind: 'fence'; item: GeoFence } | { kind: 'poi'; item: PointOfInterest };

export function GeoFencePanel() {
  const {
    geofenceDrawMode,
    setGeofenceDrawMode,
    geofencePoints,
    clearGeofencePoints,
    geofencesToDisplay,
    setGeofencesToDisplay,
    poiDropMode,
    setPoiDropMode,
    poiDropPoint,
    setPoiDropPoint,
    poisToDisplay,
    setPoisToDisplay,
    setMapDestination,
  } = useLayout();

  const [tab, setTab] = useState<Tab>('fences');
  const [loadingFences, setLoadingFences] = useState(true);
  const [loadingPois, setLoadingPois] = useState(true);

  /* ---- NEW draw state ---- */
  const [pendingFenceName, setPendingFenceName] = useState('');
  const [redrawnFenceId, setRedrawnFenceId] = useState<string | null>(null); // null = create, id = edit
  const [savingFence, setSavingFence] = useState(false);
  const [fenceError, setFenceError] = useState<string | null>(null);
  const [pendingFenceAssignedIds, setPendingFenceAssignedIds] = useState<string[]>([]);

  /* ---- Fence inline-edit state ---- */
  const [editingFenceId, setEditingFenceId] = useState<string | null>(null);
  const [editFenceName, setEditFenceName] = useState('');
  const [editFenceError, setEditFenceError] = useState<string | null>(null);
  const [savingFenceEdit, setSavingFenceEdit] = useState(false);

  /* ---- NEW drop state ---- */
  const [pendingPoiName, setPendingPoiName] = useState('');
  const [pendingRadius, setPendingRadius] = useState(100);
  const [repositionedPoiId, setRepositionedPoiId] = useState<string | null>(null); // null = create
  const [savingPoi, setSavingPoi] = useState(false);
  const [poiError, setPoiError] = useState<string | null>(null);
  const [pendingPoiAssignedIds, setPendingPoiAssignedIds] = useState<string[]>([]);

  /* ---- POI inline-edit state ---- */
  const [editingPoiId, setEditingPoiId] = useState<string | null>(null);
  const [editPoiName, setEditPoiName] = useState('');
  const [editPoiRadius, setEditPoiRadius] = useState(100);
  const [editPoiError, setEditPoiError] = useState<string | null>(null);
  const [savingPoiEdit, setSavingPoiEdit] = useState(false);

  /* ---- Shared user-assignment state ---- */
  const [deptUsers, setDeptUsers] = useState<DeptUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [editFenceAssignedIds, setEditFenceAssignedIds] = useState<string[]>([]);
  const [editPoiAssignedIds, setEditPoiAssignedIds] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  /* ---------- Load ---------- */
  const loadFences = useCallback(async () => {
    setLoadingFences(true);
    try {
      const res = await apiFetch<GeoFence[]>('/geofences');
      setGeofencesToDisplay(res.data ?? []);
    } finally {
      setLoadingFences(false);
    }
  }, [setGeofencesToDisplay]);

  const loadPois = useCallback(async () => {
    setLoadingPois(true);
    try {
      const res = await apiFetch<PointOfInterest[]>('/pois');
      setPoisToDisplay(res.data ?? []);
    } finally {
      setLoadingPois(false);
    }
  }, [setPoisToDisplay]);

  const loadDeptUsers = useCallback(async () => {
    if (deptUsers.length > 0) return; // already cached
    setLoadingUsers(true);
    try {
      // Good for the 50-user prototype. Revisit pagination/virtualization for larger customer deployments.
      const res = await apiFetch<DeptUser[]>('/users?limit=500');
      setDeptUsers(res.data ?? []);
    } finally {
      setLoadingUsers(false);
    }
  }, [deptUsers.length]);

  useEffect(() => { loadFences(); loadPois(); }, [loadFences, loadPois]);
  useWsEvent('geofence:updated', () => loadFences());
  useWsEvent('poi:updated', () => loadPois());

  /* ================================================================
     FENCE actions
  ================================================================ */

  function startDrawing(editId?: string, currentName?: string, assignedIds?: string[] | null) {
    clearGeofencePoints();
    setGeofenceDrawMode(true);
    setRedrawnFenceId(editId ?? null);
    setPendingFenceName(currentName ?? '');
    setPendingFenceAssignedIds(assignedIds ?? []);
    setFenceError(null);
    setEditingFenceId(null); // close inline edit if open
    setUserSearch('');
    setTab('fences');
    loadDeptUsers();
  }

  function cancelDrawing() {
    setGeofenceDrawMode(false);
    clearGeofencePoints();
    setPendingFenceName('');
    setPendingFenceAssignedIds([]);
    setRedrawnFenceId(null);
    setFenceError(null);
  }

  async function saveFence() {
    if (!pendingFenceName.trim()) { setFenceError('Enter a fence name'); return; }
    if (geofencePoints.length < 3) { setFenceError('Need at least 3 points'); return; }
    setSavingFence(true);
    setFenceError(null);
    try {
      if (redrawnFenceId) {
        // Updating existing fence polygon
        const res = await apiFetch<GeoFence>(`/geofences/${redrawnFenceId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: pendingFenceName.trim(),
            coordinates: geofencePoints,
            assignedUserIds: pendingFenceAssignedIds.length > 0 ? pendingFenceAssignedIds : null,
          }),
        });
        if (res.success && res.data)
          setGeofencesToDisplay((prev) => prev.map((f) => (f.id === redrawnFenceId ? res.data! : f)));
      } else {
        // Creating new fence
        const res = await apiFetch<GeoFence>('/geofences', {
          method: 'POST',
          body: JSON.stringify({
            name: pendingFenceName.trim(),
            coordinates: geofencePoints,
            assignedUserIds: pendingFenceAssignedIds.length > 0 ? pendingFenceAssignedIds : null,
          }),
        });
        if (res.success && res.data) setGeofencesToDisplay((prev) => [...prev, res.data!]);
      }
      cancelDrawing();
    } catch {
      setFenceError('Failed to save');
    } finally {
      setSavingFence(false);
    }
  }

  function openFenceEdit(fence: GeoFence) {
    setEditingFenceId(fence.id);
    setEditFenceName(fence.name);
    setEditFenceError(null);
    setEditFenceAssignedIds(fence.assignedUserIds ?? []);
    setUserSearch('');
    loadDeptUsers();
  }

  function closeFenceEdit() {
    setEditingFenceId(null);
    setEditFenceName('');
    setEditFenceError(null);
    setEditFenceAssignedIds([]);
    setUserSearch('');
  }

  async function saveFenceEdit(fence: GeoFence) {
    if (!editFenceName.trim()) return;
    setSavingFenceEdit(true);
    setEditFenceError(null);
    try {
      const assignedUserIds = editFenceAssignedIds.length > 0 ? editFenceAssignedIds : null;
      const res = await apiFetch<GeoFence>(`/geofences/${fence.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editFenceName.trim(), assignedUserIds }),
      });
      if (res.success && res.data)
        setGeofencesToDisplay((prev) => prev.map((f) => (f.id === fence.id ? res.data! : f)));
      closeFenceEdit();
    } catch {
      setEditFenceError('Failed to save changes');
    } finally {
      setSavingFenceEdit(false);
    }
  }

  async function toggleFence(fence: GeoFence) {
    const res = await apiFetch<GeoFence>(`/geofences/${fence.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !fence.active }),
    }).catch(() => null);
    if (res?.success && res.data)
      setGeofencesToDisplay((prev) => prev.map((f) => (f.id === fence.id ? res.data! : f)));
  }

  async function deleteFence(fence: GeoFence) {
    await apiFetch(`/geofences/${fence.id}`, { method: 'DELETE' }).catch(() => {});
    setGeofencesToDisplay((prev) => prev.filter((f) => f.id !== fence.id));
    if (editingFenceId === fence.id) closeFenceEdit();
  }

  /* ================================================================
     POI actions
  ================================================================ */

  function startPoiDrop(editId?: string, currentName?: string, currentRadius?: number, assignedIds?: string[] | null) {
    setPoiDropMode(true);
    setPoiDropPoint(null);
    setRepositionedPoiId(editId ?? null);
    setPendingPoiName(currentName ?? '');
    setPendingRadius(currentRadius ?? 100);
    setPendingPoiAssignedIds(assignedIds ?? []);
    setPoiError(null);
    setEditingPoiId(null);
    setUserSearch('');
    setTab('pois');
    loadDeptUsers();
  }

  function cancelPoiDrop() {
    setPoiDropMode(false);
    setPoiDropPoint(null);
    setPendingPoiName('');
    setPendingPoiAssignedIds([]);
    setRepositionedPoiId(null);
    setPoiError(null);
  }

  async function savePoi() {
    if (!poiDropPoint) { setPoiError('Drop a pin on the map first'); return; }
    if (!pendingPoiName.trim()) { setPoiError('Enter a name'); return; }
    setSavingPoi(true);
    setPoiError(null);
    try {
      const [lon, lat] = poiDropPoint;
      if (repositionedPoiId) {
        // Reposition existing POI
        const res = await apiFetch<PointOfInterest>(`/pois/${repositionedPoiId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: pendingPoiName.trim(),
            latitude: lat,
            longitude: lon,
            radiusMeters: pendingRadius,
            assignedUserIds: pendingPoiAssignedIds.length > 0 ? pendingPoiAssignedIds : null,
          }),
        });
        if (res.success && res.data)
          setPoisToDisplay((prev) => prev.map((p) => (p.id === repositionedPoiId ? res.data! : p)));
      } else {
        const res = await apiFetch<PointOfInterest>('/pois', {
          method: 'POST',
          body: JSON.stringify({
            name: pendingPoiName.trim(),
            latitude: lat,
            longitude: lon,
            radiusMeters: pendingRadius,
            assignedUserIds: pendingPoiAssignedIds.length > 0 ? pendingPoiAssignedIds : null,
          }),
        });
        if (res.success && res.data) setPoisToDisplay((prev) => [...prev, res.data!]);
      }
      cancelPoiDrop();
    } catch {
      setPoiError('Failed to save');
    } finally {
      setSavingPoi(false);
    }
  }

  function openPoiEdit(poi: PointOfInterest) {
    setEditingPoiId(poi.id);
    setEditPoiName(poi.name);
    setEditPoiRadius(poi.radiusMeters);
    setEditPoiError(null);
    setEditPoiAssignedIds(poi.assignedUserIds ?? []);
    setUserSearch('');
    loadDeptUsers();
  }

  function closePoiEdit() {
    setEditingPoiId(null);
    setEditPoiName('');
    setEditPoiError(null);
    setEditPoiAssignedIds([]);
    setUserSearch('');
  }

  async function savePoiEdit(poi: PointOfInterest) {
    if (!editPoiName.trim()) return;
    setSavingPoiEdit(true);
    setEditPoiError(null);
    try {
      const assignedUserIds = editPoiAssignedIds.length > 0 ? editPoiAssignedIds : null;
      const res = await apiFetch<PointOfInterest>(`/pois/${poi.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editPoiName.trim(), radiusMeters: editPoiRadius, assignedUserIds }),
      });
      if (res.success && res.data)
        setPoisToDisplay((prev) => prev.map((p) => (p.id === poi.id ? res.data! : p)));
      closePoiEdit();
    } catch {
      setEditPoiError('Failed to save changes');
    } finally {
      setSavingPoiEdit(false);
    }
  }

  async function togglePoi(poi: PointOfInterest) {
    const res = await apiFetch<PointOfInterest>(`/pois/${poi.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !poi.active }),
    }).catch(() => null);
    if (res?.success && res.data)
      setPoisToDisplay((prev) => prev.map((p) => (p.id === poi.id ? res.data! : p)));
  }

  async function deletePoi(poi: PointOfInterest) {
    await apiFetch(`/pois/${poi.id}`, { method: 'DELETE' }).catch(() => {});
    setPoisToDisplay((prev) => prev.filter((p) => p.id !== poi.id));
    if (editingPoiId === poi.id) closePoiEdit();
  }

  /* ---------- Derived ---------- */
  const isDrawing = geofenceDrawMode;
  const isDropping = poiDropMode || poiDropPoint !== null;
  const activeFences = geofencesToDisplay.filter((f) => f.active).length;
  const activePois = poisToDisplay.filter((p) => p.active).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="grid grid-cols-2 gap-1">
          <StatBox label="Fences" value={`${activeFences}/${geofencesToDisplay.length}`} />
          <StatBox label="POIs" value={`${activePois}/${poisToDisplay.length}`} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        <TabBtn label="Geo-Fences" active={tab === 'fences'} onClick={() => setTab('fences')} />
        <TabBtn label="Points of Interest" active={tab === 'pois'} onClick={() => setTab('pois')} />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {tab === 'fences' ? (
          loadingFences ? <Spinner /> :
          geofencesToDisplay.length === 0 && !isDrawing ? (
            <EmptyState icon={<Pencil size={22} className="text-accent/40" />} text="No fences defined." hint="Click 'Draw Fence' below." />
          ) : (
            geofencesToDisplay.map((fence) => (
              editingFenceId === fence.id ? (
                /* ---- Inline fence edit ---- */
                <div key={fence.id} className="rounded-lg border border-accent/40 bg-accent/5 px-2 py-2 space-y-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={editFenceName}
                    onChange={(e) => setEditFenceName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveFenceEdit(fence); if (e.key === 'Escape') closeFenceEdit(); }}
                    className="w-full bg-bg-card border border-border rounded px-2 py-1 text-xs text-white placeholder-text-secondary/50 focus:outline-none focus:border-accent"
                    placeholder="Fence name…"
                  />
                  {editFenceError && <p className="text-[10px] text-danger">{editFenceError}</p>}
                  <p className="text-[10px] text-text-secondary/60">{fence.coordinates.length} vertices</p>
                  <UserPicker
                    users={deptUsers}
                    selected={editFenceAssignedIds}
                    loading={loadingUsers}
                    search={userSearch}
                    onSearchChange={setUserSearch}
                    onToggle={(id) => setEditFenceAssignedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
                    onClearAll={() => setEditFenceAssignedIds([])}
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => saveFenceEdit(fence)}
                      disabled={savingFenceEdit || !editFenceName.trim()}
                      className="flex-1 bg-accent hover:bg-accent/90 disabled:opacity-40 text-white text-xs font-semibold rounded py-1 transition-colors flex items-center justify-center gap-1"
                    >
                      <CheckCircle2 size={10} /> {savingFenceEdit ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => startDrawing(fence.id, editFenceName || fence.name, editFenceAssignedIds)}
                      title="Redraw polygon"
                      className="px-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 text-xs rounded py-1 transition-colors flex items-center gap-1"
                    >
                      <RefreshCw size={10} /> Redraw
                    </button>
                    <button onClick={closeFenceEdit} className="px-2 bg-bg-card hover:bg-white/10 text-text-secondary text-xs rounded py-1 border border-border transition-colors">
                      <X size={10} />
                    </button>
                  </div>
                </div>
              ) : (
                /* ---- Normal fence row ---- */
                <div
                  key={fence.id}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${fence.active ? 'border-accent/30 bg-accent/5' : 'border-border bg-bg-card/50'}`}
                  onDoubleClick={() => setMapDestination(polygonCentroid(fence.coordinates))}
                  title="Double-click to center map"
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate cursor-default select-none ${fence.active ? 'text-white' : 'text-text-secondary'}`}>{fence.name}</p>
                    <p className="text-[10px] text-text-secondary/60">
                      {fence.coordinates.length} vertices
                      {fence.assignedUserIds && fence.assignedUserIds.length > 0 && (
                        <span className="ml-1.5 text-accent/70">· {fence.assignedUserIds.length} user{fence.assignedUserIds.length !== 1 ? 's' : ''}</span>
                      )}
                    </p>
                  </div>
                  <button onClick={() => openFenceEdit(fence)} title="Edit" className="shrink-0 text-text-secondary/50 hover:text-white transition-colors"><Pencil size={12} /></button>
                  <button onClick={() => toggleFence(fence)} title={fence.active ? 'Deactivate' : 'Activate'}
                    className={`shrink-0 transition-colors ${fence.active ? 'text-accent hover:text-accent/70' : 'text-text-secondary/50 hover:text-text-secondary'}`}>
                    {fence.active ? <Shield size={13} /> : <ShieldOff size={13} />}
                  </button>
                  <button onClick={() => setDeleteTarget({ kind: 'fence', item: fence })} title="Delete" className="shrink-0 text-text-secondary/40 hover:text-danger transition-colors"><Trash2 size={13} /></button>
                </div>
              )
            ))
          )
        ) : (
          loadingPois ? <Spinner /> :
          poisToDisplay.length === 0 && !isDropping ? (
            <EmptyState icon={<MapPin size={22} className="text-purple-400/50" />} text="No points of interest." hint="Click 'Drop POI' below." />
          ) : (
            poisToDisplay.map((poi) => (
              editingPoiId === poi.id ? (
                /* ---- Inline POI edit ---- */
                <div key={poi.id} className="rounded-lg border border-purple-500/40 bg-purple-600/5 px-2 py-2 space-y-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={editPoiName}
                    onChange={(e) => setEditPoiName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') closePoiEdit(); }}
                    className="w-full bg-bg-card border border-border rounded px-2 py-1 text-xs text-white placeholder-text-secondary/50 focus:outline-none focus:border-purple-500"
                    placeholder="POI name…"
                  />
                  {editPoiError && <p className="text-[10px] text-danger">{editPoiError}</p>}
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-text-secondary shrink-0">Radius</label>
                    <input
                      type="range" min={25} max={5000} step={25}
                      value={editPoiRadius}
                      onChange={(e) => setEditPoiRadius(Number(e.target.value))}
                      className="flex-1 accent-purple-500"
                    />
                    <input
                      type="number" min={25} max={5000} step={25}
                      value={editPoiRadius}
                      onChange={(e) => {
                        const v = Math.max(25, Math.min(5000, Number(e.target.value)));
                        if (!isNaN(v)) setEditPoiRadius(v);
                      }}
                      className="w-16 bg-bg-card border border-border rounded px-1.5 py-0.5 text-xs text-white text-right focus:outline-none focus:border-purple-500"
                    />
                    <span className="text-[10px] text-text-secondary shrink-0">m</span>
                  </div>
                  <UserPicker
                    users={deptUsers}
                    selected={editPoiAssignedIds}
                    loading={loadingUsers}
                    search={userSearch}
                    onSearchChange={setUserSearch}
                    onToggle={(id) => setEditPoiAssignedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
                    onClearAll={() => setEditPoiAssignedIds([])}
                    accent="purple"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => savePoiEdit(poi)}
                      disabled={savingPoiEdit || !editPoiName.trim()}
                      className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold rounded py-1 transition-colors flex items-center justify-center gap-1"
                    >
                      <CheckCircle2 size={10} /> {savingPoiEdit ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => startPoiDrop(poi.id, editPoiName || poi.name, editPoiRadius, editPoiAssignedIds)}
                      title="Reposition pin"
                      className="px-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-400 text-xs rounded py-1 transition-colors flex items-center gap-1"
                    >
                      <RefreshCw size={10} /> Reposition
                    </button>
                    <button onClick={closePoiEdit} className="px-2 bg-bg-card hover:bg-white/10 text-text-secondary text-xs rounded py-1 border border-border transition-colors">
                      <X size={10} />
                    </button>
                  </div>
                </div>
              ) : (
                /* ---- Normal POI row ---- */
                <div
                  key={poi.id}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${poi.active ? 'border-purple-500/30 bg-purple-600/5' : 'border-border bg-bg-card/50'}`}
                  onDoubleClick={() => setMapDestination({ lat: parseFloat(poi.latitude), lon: parseFloat(poi.longitude) })}
                  title="Double-click to center map"
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate cursor-default select-none ${poi.active ? 'text-white' : 'text-text-secondary'}`}>{poi.name}</p>
                    <p className="text-[10px] text-text-secondary/60">
                      {poi.radiusMeters}m radius
                      {poi.assignedUserIds && poi.assignedUserIds.length > 0 && (
                        <span className="ml-1.5 text-purple-400/70">· {poi.assignedUserIds.length} user{poi.assignedUserIds.length !== 1 ? 's' : ''}</span>
                      )}
                    </p>
                  </div>
                  <button onClick={() => openPoiEdit(poi)} title="Edit" className="shrink-0 text-text-secondary/50 hover:text-white transition-colors"><Pencil size={12} /></button>
                  <button onClick={() => togglePoi(poi)} title={poi.active ? 'Deactivate' : 'Activate'}
                    className={`shrink-0 transition-colors ${poi.active ? 'text-purple-400 hover:text-purple-300' : 'text-text-secondary/50 hover:text-text-secondary'}`}>
                    {poi.active ? <Shield size={13} /> : <ShieldOff size={13} />}
                  </button>
                  <button onClick={() => setDeleteTarget({ kind: 'poi', item: poi })} title="Delete" className="shrink-0 text-text-secondary/40 hover:text-danger transition-colors"><Trash2 size={13} /></button>
                </div>
              )
            ))
          )
        )}
      </div>

      {/* Bottom controls */}
      <div className="px-3 py-2 border-t border-border shrink-0 space-y-2">
        {tab === 'fences' ? (
          <>
            {fenceError && <p className="text-[10px] text-danger text-center">{fenceError}</p>}
            {isDrawing ? (
              <>
                <div className="flex items-center gap-1.5 text-blue-400 text-xs">
                  <Pencil size={11} />
                  <span className="font-medium">
                    {redrawnFenceId ? 'Redrawing — ' : ''}{geofencePoints.length} point{geofencePoints.length !== 1 ? 's' : ''}
                    {geofencePoints.length >= 3 ? ' ✓' : ' (need 3+)'}
                  </span>
                </div>
                <input
                  type="text"
                  value={pendingFenceName}
                  onChange={(e) => setPendingFenceName(e.target.value)}
                  placeholder="Fence name…"
                  className="w-full bg-bg-card border border-border rounded px-2 py-1 text-xs text-white placeholder-text-secondary/50 focus:outline-none focus:border-accent"
                  onKeyDown={(e) => { if (e.key === 'Enter') saveFence(); }}
                />
                <UserPicker
                  users={deptUsers}
                  selected={pendingFenceAssignedIds}
                  loading={loadingUsers}
                  search={userSearch}
                  onSearchChange={setUserSearch}
                  onToggle={(id) => setPendingFenceAssignedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
                  onClearAll={() => setPendingFenceAssignedIds([])}
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveFence}
                    disabled={savingFence || geofencePoints.length < 3 || !pendingFenceName.trim()}
                    className="flex-1 bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded py-1.5 transition-colors flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 size={11} />
                    {savingFence ? 'Saving…' : redrawnFenceId ? 'Update Fence' : 'Save Fence'}
                  </button>
                  <button onClick={cancelDrawing} className="px-3 bg-bg-card hover:bg-white/10 text-text-secondary text-xs rounded py-1.5 border border-border transition-colors">Cancel</button>
                </div>
              </>
            ) : (
              <button onClick={() => startDrawing()} className="w-full flex items-center justify-center gap-1.5 bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent text-xs font-semibold rounded py-1.5 transition-colors">
                <Plus size={12} /> Draw Fence
              </button>
            )}
          </>
        ) : (
          <>
            {poiError && <p className="text-[10px] text-danger text-center">{poiError}</p>}
            {isDropping ? (
              <>
                {poiDropMode ? (
                  <p className="text-xs text-purple-400 font-medium text-center">Click on the map to place the pin</p>
                ) : (
                  <p className="text-xs text-purple-300 font-medium">
                    Pin placed · {Number(poiDropPoint![1]).toFixed(5)}, {Number(poiDropPoint![0]).toFixed(5)}
                  </p>
                )}
                <input
                  type="text"
                  value={pendingPoiName}
                  onChange={(e) => setPendingPoiName(e.target.value)}
                  placeholder="Point name…"
                  className="w-full bg-bg-card border border-border rounded px-2 py-1 text-xs text-white placeholder-text-secondary/50 focus:outline-none focus:border-purple-500"
                  onKeyDown={(e) => { if (e.key === 'Enter') savePoi(); }}
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-text-secondary shrink-0">Radius</label>
                    <input
                      type="range" min={25} max={5000} step={25}
                      value={pendingRadius}
                      onChange={(e) => setPendingRadius(Number(e.target.value))}
                      className="flex-1 accent-purple-500"
                    />
                    <input
                      type="number" min={25} max={5000} step={25}
                      value={pendingRadius}
                      onChange={(e) => {
                        const v = Math.max(25, Math.min(5000, Number(e.target.value)));
                        if (!isNaN(v)) setPendingRadius(v);
                      }}
                      className="w-16 bg-bg-card border border-border rounded px-1.5 py-0.5 text-xs text-white text-right focus:outline-none focus:border-purple-500"
                    />
                    <span className="text-[10px] text-text-secondary shrink-0">m</span>
                  </div>
                </div>
                <UserPicker
                  users={deptUsers}
                  selected={pendingPoiAssignedIds}
                  loading={loadingUsers}
                  search={userSearch}
                  onSearchChange={setUserSearch}
                  onToggle={(id) => setPendingPoiAssignedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
                  onClearAll={() => setPendingPoiAssignedIds([])}
                  accent="purple"
                />
                <div className="flex gap-2">
                  <button
                    onClick={savePoi}
                    disabled={savingPoi || !poiDropPoint || !pendingPoiName.trim()}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded py-1.5 transition-colors flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 size={11} />
                    {savingPoi ? 'Saving…' : repositionedPoiId ? 'Update POI' : 'Save POI'}
                  </button>
                  <button onClick={cancelPoiDrop} className="px-3 bg-bg-card hover:bg-white/10 text-text-secondary text-xs rounded py-1.5 border border-border transition-colors">Cancel</button>
                </div>
              </>
            ) : (
              <button onClick={() => startPoiDrop()} className="w-full flex items-center justify-center gap-1.5 bg-purple-600/10 hover:bg-purple-600/20 border border-purple-600/30 text-purple-400 text-xs font-semibold rounded py-1.5 transition-colors">
                <Plus size={12} /> Drop POI
              </button>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.kind === 'fence' ? 'Geofence' : 'POI'}`}
        message={
          deleteTarget
            ? `Delete "${deleteTarget.item.name}"? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!deleteTarget) return;
          if (deleteTarget.kind === 'fence') await deleteFence(deleteTarget.item);
          else await deletePoi(deleteTarget.item);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex-1 text-[11px] font-semibold py-1.5 transition-colors border-b-2 ${active ? 'border-accent text-white' : 'border-transparent text-text-secondary hover:text-white'}`}>
      {label}
    </button>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border px-1.5 py-1 text-center">
      <p className="text-sm font-semibold text-white">{value}</p>
      <p className="text-[10px] text-text-secondary uppercase">{label}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-6">
      <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ icon, text, hint }: { icon: React.ReactNode; text: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
      {icon}
      <p className="text-xs text-text-secondary">{text}</p>
      <p className="text-[10px] text-text-secondary/60">{hint}</p>
    </div>
  );
}

interface UserPickerProps {
  users: DeptUser[];
  selected: string[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  onToggle: (id: string) => void;
  onClearAll: () => void;
  accent?: 'blue' | 'purple';
}

function UserPicker({ users, selected, loading, search, onSearchChange, onToggle, onClearAll, accent = 'blue' }: UserPickerProps) {
  const [expanded, setExpanded] = useState(false);

  const accentCls = accent === 'purple'
    ? { chip: 'bg-purple-600/20 text-purple-300 border-purple-500/30', check: 'accent-purple-500', btn: 'text-purple-400 hover:text-purple-300' }
    : { chip: 'bg-accent/15 text-accent border-accent/30', check: 'accent-accent', btn: 'text-accent hover:text-accent/80' };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return `${u.firstName} ${u.lastName} ${u.username}`.toLowerCase().includes(q);
  });

  return (
    <div className="rounded border border-border bg-bg-sidebar/30 px-2 py-1.5 space-y-1.5">
      {/* Header row */}
      <div className="flex items-center gap-1.5">
        <Users size={10} className="text-text-secondary/60 shrink-0" />
        <span className="text-[10px] text-text-secondary flex-1">
          {selected.length === 0 ? 'All users monitored' : `${selected.length} user${selected.length !== 1 ? 's' : ''} assigned`}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className={`text-[10px] font-medium transition-colors ${accentCls.btn}`}
        >
          {expanded ? 'Done' : 'Edit'}
        </button>
        {selected.length > 0 && (
          <button onClick={onClearAll} className="text-[10px] text-text-secondary/50 hover:text-danger transition-colors">All</button>
        )}
      </div>

      {/* Selected chips */}
      {selected.length > 0 && !expanded && (
        <div className="flex flex-wrap gap-1">
          {selected.map((id) => {
            const u = users.find((x) => x.id === id);
            if (!u) return null;
            return (
              <span key={id} className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${accentCls.chip}`}>
                {u.firstName} {u.lastName}
                <button onClick={() => onToggle(id)} className="opacity-60 hover:opacity-100 ml-0.5"><X size={8} /></button>
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded picker */}
      {expanded && (
        <div className="space-y-1">
          <div className="relative">
            <Search size={9} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-secondary/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search users…"
              className="w-full bg-bg-card border border-border rounded pl-5 pr-2 py-0.5 text-[11px] text-white placeholder-text-secondary/40 focus:outline-none focus:border-accent"
            />
          </div>
          {loading ? (
            <p className="text-[10px] text-text-secondary/50 text-center py-1">Loading…</p>
          ) : (
            <div className="max-h-28 overflow-y-auto space-y-0.5 pr-0.5">
              {filtered.length === 0 && <p className="text-[10px] text-text-secondary/50 text-center py-1">No users found</p>}
              {filtered.map((u) => (
                <label key={u.id} className="flex items-center gap-1.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selected.includes(u.id)}
                    onChange={() => onToggle(u.id)}
                    className={`shrink-0 ${accentCls.check}`}
                  />
                  <span className="text-[11px] text-white group-hover:text-accent transition-colors truncate">
                    {u.firstName} {u.lastName}
                    <span className="text-text-secondary/50 ml-1">@{u.username}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
