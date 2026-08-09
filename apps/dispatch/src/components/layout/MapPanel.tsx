/*
 * PushComm Community Edition
 * Copyright (C) 2026 Corbani Mauro
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin, Maximize2, Minimize2 } from 'lucide-react';
import { useMapOverview } from '../../hooks/useMapOverview';
import { useLayout } from '../../contexts/LayoutContext';
import { useWsEvent } from '../../contexts/WebSocketContext';
import { MapSearchBar } from './MapSearchBar';
import { apiFetch } from '../../lib/api';

const TRAIL_COLORS = ['#e67e22', '#3b82f6', '#10b981', '#a855f7', '#f43f5e', '#06b6d4'];
const MAX_TRAIL_POINTS = 500; // per user

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Returns { label, color } for a GPS timestamp — shows real clock time + staleness tint */
function gpsAgeInfo(iso: string): { label: string; color: string } {
  const ageMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ageMs / 60_000);
  const time = new Date(iso).toLocaleTimeString();
  if (mins < 3) return { label: `${time} (live)`, color: '#34d399' };     // emerald — fresh
  if (mins < 10) return { label: `${time} (${mins}m ago)`, color: '#fbbf24' }; // amber — getting stale
  return { label: `${time} (${mins}m ago)`, color: '#f87171' };             // red — stale
}

function compactUnitBadge(driver: { firstName?: string; lastName?: string; username?: string }): string {
  const firstName = driver.firstName?.trim() ?? '';
  const lastName = driver.lastName?.trim() ?? '';

  if (/^unit$/i.test(firstName) && /^\d+$/.test(lastName)) {
    return `U${lastName.padStart(2, '0')}`.slice(0, 4).toUpperCase();
  }

  const usernameNumber = driver.username?.match(/(?:^|_)(\d{1,3})$/)?.[1];
  if (usernameNumber) {
    return `U${usernameNumber.padStart(2, '0')}`.slice(0, 4).toUpperCase();
  }

  return [firstName[0], lastName[0]].filter(Boolean).join('').toUpperCase() || '?';
}

const DEFAULT_CENTER: [number, number] = [-122.4194, 37.7749];
const DEFAULT_ZOOM = 11;
// Base map raster tiles.
//
// The default points at the OpenStreetMap Foundation's public tile server.
// That server runs on donated infrastructure and its Tile Usage Policy asks
// that redistributed products not use it as a bulk default, so if you run
// PushComm for a real fleet, point VITE_MAP_TILE_URL at your own tile server
// (or a commercial provider) at build time. Whatever you use, keep an
// attribution that credits the data source — OSM data is ODbL-licensed and
// attribution is a licence condition, not a courtesy.
const PUBLIC_TILE_URL =
  (import.meta.env.VITE_MAP_TILE_URL as string | undefined)?.trim() ||
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined)?.trim() ||
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const LOCAL_TILE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [PUBLIC_TILE_URL],
      tileSize: 256,
      attribution: TILE_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
};

const escapePopup = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// Generic titled popup: a caller supplies its own title + lines.
function buildGenericPopupHtml(popup: { title: string; lines?: string[]; accent?: string }): string {
  const titleStyle = popup.accent ? ` style="color:${escapePopup(popup.accent)}"` : '';
  const lines = (popup.lines ?? []).filter(Boolean).map((l) => `<br/>${escapePopup(String(l))}`).join('');
  return `<div style="font-size:12px;max-width:240px;line-height:1.35"><strong${titleStyle}>${escapePopup(popup.title)}</strong>${lines}</div>`;
}

// Non-WebGL fallback map (browsers with WebGL disabled/blocklisted — common on
// integrated GPUs, VMs, remote desktop). Unlike a static tile map, this listens
// for unit data postMessage'd from the parent and renders live, moving markers,
// so the console isn't an empty map when MapLibre can't run.
const LEAFLET_FALLBACK_DOC = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
      html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; background: #0b1220; }
      .pc-fb-icon { background: none !important; border: none !important; }
      .pc-fb-pin { display: flex; flex-direction: column; align-items: center; transform: translateY(-2px); }
      .pc-fb-av {
        width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        font: 600 10px system-ui, sans-serif; color: #fff; background: #e67e22;
        border: 2px solid rgba(255,255,255,0.85); box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      }
      .pc-fb-nm {
        margin-top: 1px; font: 600 10px ui-monospace, monospace; color: #e8eef5; white-space: nowrap;
        background: rgba(17,24,39,0.82); border: 1px solid rgba(255,255,255,0.15); padding: 0 5px; border-radius: 9999px;
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script>
      var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([37.7749, -122.4194], 10);
      L.control.attribution({ prefix: false }).addTo(map);
      L.tileLayer(${JSON.stringify(PUBLIC_TILE_URL)}, { maxZoom: 18, attribution: ${JSON.stringify(TILE_ATTRIBUTION)} }).addTo(map);
      var markers = {};
      var fitted = false;
      function badge(d) {
        var f = (d.firstName || '')[0] || '';
        var l = (d.lastName || '')[0] || '';
        return ((f + l).toUpperCase()) || (d.username || '?').slice(0, 2).toUpperCase();
      }
      window.addEventListener('message', function (e) {
        var msg = e.data;
        if (!msg || msg.type !== 'pc-markers' || !Array.isArray(msg.drivers)) return;
        var seen = {};
        msg.drivers.forEach(function (d) {
          if (d.latitude == null || d.longitude == null) return;
          seen[d.id] = 1;
          var ll = [Number(d.latitude), Number(d.longitude)];
          if (markers[d.id]) {
            markers[d.id].setLatLng(ll);
            var av = markers[d.id].getElement() && markers[d.id].getElement().querySelector('.pc-fb-av');
            if (av && d.statusColor) av.style.background = d.statusColor;
          } else {
            var color = d.statusColor || '#e67e22';
            var html = '<div class="pc-fb-pin"><span class="pc-fb-av" style="background:' + color + '">' + badge(d) +
              '</span><span class="pc-fb-nm">' + (d.username || '') + '</span></div>';
            var icon = L.divIcon({ className: 'pc-fb-icon', html: html, iconSize: [26, 38], iconAnchor: [13, 19] });
            markers[d.id] = L.marker(ll, { icon: icon, title: (d.firstName || '') + ' ' + (d.lastName || '') }).addTo(map);
          }
        });
        Object.keys(markers).forEach(function (id) {
          if (!seen[id]) { map.removeLayer(markers[id]); delete markers[id]; }
        });
        if (!fitted && msg.drivers.length) {
          var pts = msg.drivers.filter(function (d) { return d.latitude != null; })
            .map(function (d) { return [Number(d.latitude), Number(d.longitude)]; });
          if (pts.length) { fitted = true; map.fitBounds(pts, { padding: [60, 60], maxZoom: 12 }); }
        }
      });
      if (window.parent) window.parent.postMessage({ type: 'pc-fallback-ready' }, '*');
    </script>
  </body>
</html>`;

interface MapPanelProps {
  /** Whether the map is currently a full-screen background */
  isBackground?: boolean;
  /** Called to detach from background into floating panel */
  onDetach?: () => void;
  /** Called to dock back as background */
  onDock?: () => void;
  /** User IDs whose GPS trails should be drawn on the map */
  trackedIds?: Set<string>;
  onCallUnit?: (unitId: string, name: string) => void;
  onMessageUnit?: (unitId: string, name: string) => void;
  onSelectGroupVoice?: (groupId: string, name: string) => void;
  onMessageGroup?: (groupId: string, name: string) => void;
  showOperationalZones?: boolean;
  /** User IDs with an active SOS — their markers render red + pulsing. */
  sosUserIds?: Set<string>;
  /** Fly the map to an SOS sender's location (no pin dropped). */
  sosFocus?: { lat: number; lon: number; key: string } | null;
  /** The unit currently transmitting (PTT floor holder, or demo chatter). Its
   *  marker turns into a green pulsing speaker; the map follows it when
   *  followTalker is on. Match by id (preferred) or username. */
  speakingUnit?: { id?: string; username?: string } | null;
  /** Auto-zoom to the talking unit (off = highlight only, map stays put). */
  followTalker?: boolean;
}

export function MapPanel({
  isBackground,
  onDetach,
  onDock,
  trackedIds,
  onCallUnit,
  onMessageUnit,
  onSelectGroupVoice,
  onMessageGroup,
  showOperationalZones = false,
  sosUserIds,
  sosFocus,
  speakingUnit,
  followTalker = true,
}: MapPanelProps = {}) {
  const { data, loading } = useMapOverview();
  const {
    mapDestination,
    mapFocus,
    geofenceDrawMode,
    geofencePoints,
    addGeofencePoint,
    geofencesToDisplay,
    poiDropMode,
    setPoiDropMode,
    poiDropPoint,
    setPoiDropPoint,
    poisToDisplay,
  } = useLayout();

  const poiDropMarkerRef = useRef<Marker | null>(null);
  const searchPinRef = useRef<Marker | null>(null);
  const searchPopupRef = useRef<maplibregl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const didFitRef = useRef(false);
  const driverMarkersRef = useRef<Map<string, Marker>>(new Map());
  const sosUserIdsRef = useRef<Set<string> | undefined>(sosUserIds);
  const speakingIdRef = useRef<string | null>(null);
  const fallbackIframeRef = useRef<HTMLIFrameElement | null>(null);
  const focusMarkerRef = useRef<Marker | null>(null);
  const focusPopupRef = useRef<maplibregl.Popup | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);
  const destPopupRef = useRef<maplibregl.Popup | null>(null);
  const poiMarkersRef = useRef<Map<string, Marker>>(new Map());
  // Trail data: userId → ordered [lon, lat][] points (rolling window)
  const trailPointsRef = useRef<Map<string, [number, number][]>>(new Map());
  const trackedIdsRef = useRef<Set<string>>(trackedIds ?? new Set());
  useEffect(() => { trackedIdsRef.current = trackedIds ?? new Set(); }, [trackedIds]);

  // Move driver marker immediately from WS payload — no API round-trip needed
  useWsEvent('location:update', (payload: { userId: string; latitude: number; longitude: number }) => {
    const { userId, latitude, longitude } = payload;
    const marker = driverMarkersRef.current.get(userId);
    if (marker) {
      marker.setLngLat([longitude, latitude]);
      const el = marker.getElement();
      el.dataset.lat = String(latitude);
      el.dataset.lon = String(longitude);
      el.dataset.lastAt = new Date().toISOString();
    }
  });

  // Accumulate GPS fixes for tracked users and redraw trails
  useWsEvent('location:update', (payload: { userId: string; latitude: number; longitude: number }) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const { userId, latitude, longitude } = payload;
    if (!trackedIdsRef.current.has(userId)) return;

    const pts = trailPointsRef.current.get(userId) ?? [];
    pts.push([longitude, latitude]);
    if (pts.length > MAX_TRAIL_POINTS) pts.splice(0, pts.length - MAX_TRAIL_POINTS);
    trailPointsRef.current.set(userId, pts);

    const sourceId = `trail-${userId}`;
    const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
    }
  });

  // Add/remove trail sources+layers when trackedIds changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const currentTracked = trackedIds ?? new Set<string>();
    const trackedArr = [...currentTracked];

    // Remove trails for users no longer tracked
    trailPointsRef.current.forEach((_, userId) => {
      if (!currentTracked.has(userId)) {
        const sourceId = `trail-${userId}`;
        if (map.getLayer(sourceId)) map.removeLayer(sourceId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        trailPointsRef.current.delete(userId);
      }
    });

    // Add trail source+layer for newly tracked users
    trackedArr.forEach((userId, idx) => {
      const sourceId = `trail-${userId}`;
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
        });
        map.addLayer({
          id: sourceId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': TRAIL_COLORS[idx % TRAIL_COLORS.length],
            'line-width': 3,
            'line-opacity': 0.75,
          },
        });
      }
    });
  }, [trackedIds, mapLoaded]);

  // Stable click handler — reads live values from data-* attrs set on each render
  const handleUnitClick = useCallback((evt: MouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    evt.stopPropagation();

    const el = evt.currentTarget as HTMLElement;
    const lat = Number(el.dataset.lat);
    const lon = Number(el.dataset.lon);
    const name = el.dataset.name ?? '';
    const username = el.dataset.username ?? '';
    const userId = el.dataset.uid ?? '';
    const groupId = el.dataset.groupId ?? '';
    const groupName = el.dataset.groupName ?? '';
    const statusLabel = el.dataset.statusLabel ?? '';
    const statusColor = el.dataset.statusColor ?? '';
    const lastAt = el.dataset.lastAt ?? '';
    const uid = el.dataset.uid ?? String(Date.now());
    const unitVoiceId = `pc-action-unit-voice-${uid}`;
    const unitMessageId = `pc-action-unit-message-${uid}`;
    const groupVoiceId = `pc-action-group-voice-${uid}`;
    const groupMessageId = `pc-action-group-message-${uid}`;

    popupRef.current?.remove();

    const addrId = `pc-addr-${uid}`;
    const gps = lastAt ? gpsAgeInfo(lastAt) : null;
    // Surface SOS context: a red marker's popup should make the emergency obvious.
    const hasSos = sosUserIdsRef.current?.has(userId) ?? false;
    const html = `<div class="pc-popup">
      ${hasSos ? `<p class="pc-popup-sos">⚠ SOS ACTIVE</p>` : ''}
      <p class="pc-popup-name">${escapeHtml(name)}</p>
      <p class="pc-popup-call">@${escapeHtml(username)}</p>
      ${groupName ? `<p class="pc-popup-group">${escapeHtml(groupName)}</p>` : ''}
      ${statusLabel ? `<p class="pc-popup-status"><span style="background:${escapeHtml(statusColor || '#94a3b8')}"></span>${escapeHtml(statusLabel)}</p>` : ''}
      <p class="pc-popup-coords">${lat.toFixed(6)}, ${lon.toFixed(6)}</p>
      <p class="pc-popup-addr" id="${addrId}">Resolving address…</p>
      ${gps ? `<p class="pc-popup-meta" style="color:${gps.color}">GPS: ${gps.label}</p>` : ''}
      <div class="pc-popup-actions">
        ${onCallUnit ? `<button type="button" id="${unitVoiceId}" class="pc-popup-action">Voice Unit</button>` : ''}
        ${onMessageUnit ? `<button type="button" id="${unitMessageId}" class="pc-popup-action">Msg Unit</button>` : ''}
        ${groupId && onSelectGroupVoice ? `<button type="button" id="${groupVoiceId}" class="pc-popup-action">Voice Group</button>` : ''}
        ${groupId && onMessageGroup ? `<button type="button" id="${groupMessageId}" class="pc-popup-action">Msg Group</button>` : ''}
      </div>
    </div>`;

    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '270px', offset: 14 })
      .setLngLat([lon, lat])
      .setHTML(html)
      .addTo(map);

    document.getElementById(unitVoiceId)?.addEventListener('click', () => onCallUnit?.(userId, name));
    document.getElementById(unitMessageId)?.addEventListener('click', () => onMessageUnit?.(userId, name));
    document.getElementById(groupVoiceId)?.addEventListener('click', () => onSelectGroupVoice?.(groupId, groupName));
    document.getElementById(groupMessageId)?.addEventListener('click', () => onMessageGroup?.(groupId, groupName));

    // Best-effort reverse geocoding through the API, with graceful fallback.
    apiFetch<Array<{ address: string; label: string }>>(
      `/geocoding/reverse?lat=${lat}&lng=${lon}`,
    )
      .then((res) => {
        const addrEl = document.getElementById(addrId);
        const geo = res.data?.[0];
        if (addrEl) addrEl.textContent = geo?.address || geo?.label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      })
      .catch(() => {
        const addrEl = document.getElementById(addrId);
        if (addrEl) addrEl.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      });
  }, [onCallUnit, onMessageGroup, onMessageUnit, onSelectGroupVoice]);

  const handleSearchResult = useCallback((lon: number, lat: number, displayName: string) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous search pin + popup
    searchPopupRef.current?.remove();
    searchPinRef.current?.remove();

    map.flyTo({ center: [lon, lat], zoom: 15, duration: 1200 });

    const el = document.createElement('div');
    el.className = 'pc-map-search-pin';
    el.innerHTML = '<div class="pc-map-search-teardrop"></div>';

    searchPopupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '260px', offset: [0, -20] })
      .setLngLat([lon, lat])
      .setHTML(`<div class="pc-popup"><p class="pc-popup-name" style="color:#38bdf8">${escapeHtml(displayName.split(',').slice(0, 2).join(',').trim())}</p><p class="pc-popup-addr">${escapeHtml(displayName)}</p></div>`);

    searchPinRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lon, lat])
      .setPopup(searchPopupRef.current)
      .addTo(map);

    searchPopupRef.current.addTo(map);
  }, []);

  const webglSupported = useMemo(() => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch {
      return false;
    }
  }, []);

  const points = useMemo(() => {
    const drivers = data?.drivers || [];
    return drivers.map((d) => ({ lon: d.longitude, lat: d.latitude }));
  }, [data?.drivers]);

  useEffect(() => {
    if (!webglSupported || !mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: LOCAL_TILE_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 18,
      minZoom: 3,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;
    map.once('load', () => {
      setMapLoaded(true);
      requestAnimationFrame(() => map.resize());

      // Geofence saved-fences source + layers
      map.addSource('geofence-saved', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'geofence-saved-fill',
        type: 'fill',
        source: 'geofence-saved',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'geofence-saved-line',
        type: 'line',
        source: 'geofence-saved',
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.8 },
      });

      // POI circles source + layers (radius polygons + center dots)
      map.addSource('poi-circles', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'poi-circles-fill',
        type: 'fill',
        source: 'poi-circles',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#a855f7', 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'poi-circles-line',
        type: 'line',
        source: 'poi-circles',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'line-color': '#a855f7', 'line-width': 2, 'line-dasharray': [6, 3] },
      });

      // In-progress drawing source + layers
      map.addSource('geofence-drawing', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'geofence-drawing-fill',
        type: 'fill',
        source: 'geofence-drawing',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.1 },
      });
      map.addLayer({
        id: 'geofence-drawing-line',
        type: 'line',
        source: 'geofence-drawing',
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [4, 2] },
      });
      map.addLayer({
        id: 'geofence-drawing-points',
        type: 'circle',
        source: 'geofence-drawing',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#3b82f6',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      });
    });

    map.on('error', () => setMapLoaded(false));

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      popupRef.current?.remove();
      popupRef.current = null;
      destPopupRef.current?.remove();
      destPopupRef.current = null;
      destMarkerRef.current?.remove();
      destMarkerRef.current = null;
      poiDropMarkerRef.current?.remove();
      poiDropMarkerRef.current = null;
      for (const m of poiMarkersRef.current.values()) m.remove();
      poiMarkersRef.current.clear();
      for (const marker of driverMarkersRef.current.values()) marker.remove();
      driverMarkersRef.current.clear();
      searchPopupRef.current?.remove();
      searchPinRef.current?.remove();
      map.remove();
      mapRef.current = null;
      didFitRef.current = false;
    };
  }, [webglSupported]);

  useEffect(() => {
    const map = mapRef.current;
    if (!webglSupported || !map) return;

    const drivers = data?.drivers || [];

    const existingDriverIds = new Set(driverMarkersRef.current.keys());
    for (const driver of drivers) {
      existingDriverIds.delete(driver.id);
      let marker = driverMarkersRef.current.get(driver.id);
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'pc-map-unit-marker';
        const avatar = document.createElement('div');
        avatar.className = 'pc-map-unit-avatar';
        const nameTag = document.createElement('span');
        nameTag.className = 'pc-map-unit-name';
        el.appendChild(avatar);
        el.appendChild(nameTag);
        el.addEventListener('click', handleUnitClick);
        marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([driver.longitude, driver.latitude])
          .addTo(map);
        driverMarkersRef.current.set(driver.id, marker);
      } else {
        marker.setLngLat([driver.longitude, driver.latitude]);
      }
      // Always keep data attrs fresh so the click handler reads current values
      const el = marker.getElement();
      el.querySelector('.pc-map-unit-avatar')!.textContent = compactUnitBadge(driver);
      el.querySelector('.pc-map-unit-name')!.textContent = driver.username || `${driver.firstName} ${driver.lastName}`;
      el.dataset.lat = String(driver.latitude);
      el.dataset.lon = String(driver.longitude);
      el.dataset.name = `${driver.firstName} ${driver.lastName}`;
      el.dataset.username = driver.username;
      el.dataset.groupId = driver.groupId ?? '';
      el.dataset.groupName = driver.groupName ?? '';
      el.dataset.statusLabel = driver.statusLabel ?? '';
      el.dataset.statusColor = driver.statusColor ?? '';
      el.dataset.lastAt = driver.lastLocationAt ?? '';
      el.dataset.uid = driver.id;
      el.classList.toggle('pc-map-unit-sos', !!sosUserIdsRef.current?.has(driver.id));

      const lastSeen = driver.lastLocationAt ? ` · ${new Date(driver.lastLocationAt).toLocaleTimeString()}` : '';
      const status = driver.statusLabel ? ` - ${driver.statusLabel}` : '';
      el.title = `${driver.firstName} ${driver.lastName}${status}${lastSeen}`;
    }
    for (const staleId of existingDriverIds) {
      driverMarkersRef.current.get(staleId)?.remove();
      driverMarkersRef.current.delete(staleId);
    }

    if (!didFitRef.current && points.length > 0) {
      didFitRef.current = true;
      const b = new maplibregl.LngLatBounds([points[0].lon, points[0].lat], [points[0].lon, points[0].lat]);
      for (const p of points) b.extend([p.lon, p.lat]);
      map.fitBounds(b, { padding: 70, maxZoom: 13, duration: 700 });
    }
  }, [data?.drivers, handleUnitClick, points, webglSupported]);

  // Keep the SOS set ref fresh and re-paint existing markers immediately when an
  // SOS is raised or cleared (so we don't wait for the next overview refresh).
  useEffect(() => {
    sosUserIdsRef.current = sosUserIds;
    for (const [id, marker] of driverMarkersRef.current) {
      marker.getElement().classList.toggle('pc-map-unit-sos', !!sosUserIds?.has(id));
    }
  }, [sosUserIds]);

  // Fly to an SOS sender's location (no pin — their own marker is already there,
  // rendered red + pulsing).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !sosFocus) return;
    map.flyTo({ center: [sosFocus.lon, sosFocus.lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });
  }, [sosFocus, mapLoaded]);

  // "Follow the talker": the transmitting unit's marker turns into a green
  // pulsing speaker, and (when enabled) the map eases to it. Driven by real PTT
  // floor events in the product and by the demo chatter on the kiosk. Match by
  // marker id (preferred) or by username.
  useEffect(() => {
    if (!webglSupported) return;
    const map = mapRef.current;

    let targetId: string | null = null;
    if (speakingUnit) {
      if (speakingUnit.id && driverMarkersRef.current.has(speakingUnit.id)) {
        targetId = speakingUnit.id;
      } else if (speakingUnit.username) {
        const want = speakingUnit.username.toLowerCase();
        for (const [id, marker] of driverMarkersRef.current) {
          if (marker.getElement().dataset.username?.toLowerCase() === want) { targetId = id; break; }
        }
      }
    }

    if (targetId !== speakingIdRef.current) {
      if (speakingIdRef.current) {
        driverMarkersRef.current.get(speakingIdRef.current)?.getElement().classList.remove('pc-map-unit-speaking');
      }
      if (targetId) {
        driverMarkersRef.current.get(targetId)?.getElement().classList.add('pc-map-unit-speaking');
      }
      speakingIdRef.current = targetId;
    }

    if (targetId && followTalker && map && mapLoaded) {
      const ll = driverMarkersRef.current.get(targetId)!.getLngLat();
      map.flyTo({ center: [ll.lng, ll.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });
    }
  }, [speakingUnit, followTalker, mapLoaded, webglSupported]);

  // Non-WebGL fallback: push live unit positions into the Leaflet iframe so the
  // fallback map shows moving markers (not just empty tiles). The iframe pings
  // 'pc-fallback-ready' on load; we also resend on every overview refresh.
  useEffect(() => {
    if (webglSupported) return;
    const sendDrivers = () => {
      const drivers = (data?.drivers || []).map((d) => ({
        id: d.id, username: d.username, firstName: d.firstName, lastName: d.lastName,
        latitude: d.latitude, longitude: d.longitude, statusColor: d.statusColor,
      }));
      fallbackIframeRef.current?.contentWindow?.postMessage({ type: 'pc-markers', drivers }, '*');
    };
    sendDrivers();
    const onMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'pc-fallback-ready') sendDrivers();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [webglSupported, data?.drivers]);

  // Map focus — drops a distinct pin, flies there, and opens an optional popup.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    focusMarkerRef.current?.remove();
    focusMarkerRef.current = null;
    focusPopupRef.current?.remove();
    focusPopupRef.current = null;
    if (!mapFocus) return;
    const el = document.createElement('div');
    el.className = 'pc-map-focus-marker';
    el.innerHTML = '<div class="pc-map-focus-pin"></div>';
    focusMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([mapFocus.lon, mapFocus.lat])
      .addTo(map);
    map.flyTo({ center: [mapFocus.lon, mapFocus.lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });
    if (mapFocus.popup) {
      focusPopupRef.current = new maplibregl.Popup({ closeButton: true, offset: [0, -28] })
        .setLngLat([mapFocus.lon, mapFocus.lat])
        .setHTML(buildGenericPopupHtml(mapFocus.popup))
        .addTo(map);
    }
  }, [mapFocus, mapLoaded]);

  // Destination pin — placed when a location message is tapped in chat
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Remove previous destination marker + popup
    destPopupRef.current?.remove();
    destPopupRef.current = null;
    destMarkerRef.current?.remove();
    destMarkerRef.current = null;

    if (!mapDestination) return;

    const { lat, lon } = mapDestination;

    // Build marker element — red pin
    const el = document.createElement('div');
    el.className = 'pc-map-dest-marker';
    el.innerHTML = `<div class="pc-map-dest-pin"></div>`;

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    const popupHtml = `<div class="pc-popup">
      <p class="pc-popup-name">📍 Shared Location</p>
      <p class="pc-popup-coords">${lat.toFixed(6)}, ${lon.toFixed(6)}</p>
      <a href="${mapsUrl}" target="_blank" rel="noreferrer" class="pc-popup-directions-link">🗺 Get Directions</a>
    </div>`;

    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '240px', offset: 30 })
      .setHTML(popupHtml);
    destPopupRef.current = popup;

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lon, lat])
      .setPopup(popup)
      .addTo(map);
    destMarkerRef.current = marker;

    // Center map on destination
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });

    // Auto-open popup after fly
    setTimeout(() => marker.togglePopup(), 900);
  }, [mapDestination, mapLoaded]);

  // Drawing mode — capture map clicks to add polygon vertices
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (!geofenceDrawMode) {
      map.getCanvas().style.cursor = '';
      return;
    }

    map.getCanvas().style.cursor = 'crosshair';

    const onClick = (e: maplibregl.MapMouseEvent) => {
      addGeofencePoint([e.lngLat.lng, e.lngLat.lat]);
    };
    map.on('click', onClick);

    return () => {
      map.off('click', onClick);
      map.getCanvas().style.cursor = '';
    };
  }, [geofenceDrawMode, mapLoaded, addGeofencePoint]);

  // Update drawing preview GeoJSON source
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('geofence-drawing') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features: any[] = [];

    if (geofencePoints.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: geofencePoints },
        properties: {},
      });
    }

    if (geofencePoints.length >= 3) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...geofencePoints, geofencePoints[0]]] },
        properties: {},
      });
    }

    for (const pt of geofencePoints) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pt },
        properties: {},
      });
    }

    src.setData({ type: 'FeatureCollection', features });
  }, [geofencePoints, mapLoaded]);

  // Display saved geofences on map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('geofence-saved') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const FENCE_COLORS = ['#e67e22', '#3b82f6', '#10b981', '#a855f7', '#ef4444', '#f59e0b'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features: any[] = (showOperationalZones ? geofencesToDisplay : [])
      .filter((f) => f.active)
      .map((f, i) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[...f.coordinates, f.coordinates[0]]],
        },
        properties: {
          id: f.id,
          name: f.name,
          color: FENCE_COLORS[i % FENCE_COLORS.length],
        },
      }));

    src.setData({ type: 'FeatureCollection', features });
  }, [geofencesToDisplay, mapLoaded, showOperationalZones]);

  // POI drop mode — single click places a pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (!poiDropMode) {
      map.getCanvas().style.cursor = geofenceDrawMode ? 'crosshair' : '';
      return;
    }
    map.getCanvas().style.cursor = 'crosshair';
    const onClick = (e: maplibregl.MapMouseEvent) => {
      setPoiDropPoint([e.lngLat.lng, e.lngLat.lat]);
      setPoiDropMode(false);
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [poiDropMode, mapLoaded, geofenceDrawMode, setPoiDropPoint, setPoiDropMode]);

  // POI drop preview marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    poiDropMarkerRef.current?.remove();
    poiDropMarkerRef.current = null;
    if (!poiDropPoint) return;
    const [lon, lat] = poiDropPoint;
    const el = document.createElement('div');
    el.className = 'pc-map-poi-drop';
    el.innerHTML = '<div class="pc-map-poi-diamond"></div>';
    poiDropMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lon, lat])
      .addTo(map);
  }, [poiDropPoint, mapLoaded]);

  // Display POI circles on map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('poi-circles') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features: any[] = [];

    for (const poi of (showOperationalZones ? poisToDisplay : []).filter((p) => p.active)) {
      const lat = parseFloat(poi.latitude);
      const lon = parseFloat(poi.longitude);
      const r = poi.radiusMeters;
      const steps = 64;
      const earthR = 6371000;
      const ring: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        const dLat = (r * Math.cos(angle)) / earthR * (180 / Math.PI);
        const dLon = (r * Math.sin(angle)) / (earthR * Math.cos(lat * Math.PI / 180)) * (180 / Math.PI);
        ring.push([lon + dLon, lat + dLat]);
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { id: poi.id, name: poi.name },
      });
    }

    src.setData({ type: 'FeatureCollection', features });

    // Update POI HTML markers (recreate on each change — simple approach)
    for (const m of poiMarkersRef.current.values()) m.remove();
    poiMarkersRef.current.clear();

    for (const poi of (showOperationalZones ? poisToDisplay : []).filter((p) => p.active)) {
      const lat = parseFloat(poi.latitude);
      const lon = parseFloat(poi.longitude);
      const el = document.createElement('div');
      el.className = 'pc-map-poi-marker';
      el.innerHTML = `<div class="pc-map-poi-diamond"></div><span class="pc-map-poi-label">${escapeHtml(poi.name)}</span>`;
      el.title = `${poi.name} · ${poi.radiusMeters}m radius`;
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lon, lat])
        .addTo(map);
      poiMarkersRef.current.set(poi.id, marker);
    }
  }, [poisToDisplay, mapLoaded, showOperationalZones]);

  return (
    <div className="relative w-full h-full bg-[#0c121c]">
      {!webglSupported && (
        <iframe ref={fallbackIframeRef} title="Map Fallback" className="absolute inset-0 w-full h-full border-0 z-0" srcDoc={LEAFLET_FALLBACK_DOC} />
      )}
      <div ref={mapContainerRef} className={`absolute inset-0 z-[1] ${mapLoaded ? 'opacity-100' : 'opacity-0'}`} />

      {(onDetach || onDock) && (
        <button
          onClick={isBackground ? onDetach : onDock}
          className="absolute top-3 right-3 z-10 rounded-lg border border-border bg-bg-sidebar/92 backdrop-blur-sm px-2.5 py-1.5 text-xs text-text-secondary hover:text-white hover:bg-bg-sidebar transition-colors cursor-pointer flex items-center gap-1.5"
          title={isBackground ? 'Detach map into floating window' : 'Dock map as background'}
        >
          {isBackground ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
          {isBackground ? 'Detach' : 'Dock'}
        </button>
      )}

      {(!data || data.drivers.length === 0) && !loading && !geofenceDrawMode && (
        <div className="absolute bottom-2 left-2 z-10 text-[10px] text-text-secondary/70 bg-bg-sidebar/80 px-2 py-1 rounded font-mono pointer-events-none">
          <MapPin size={10} className="inline mr-1" />
          No units reporting GPS yet
        </div>
      )}

      {!geofenceDrawMode && !poiDropMode && (
        <MapSearchBar onSelect={handleSearchResult} />
      )}

      {geofenceDrawMode && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-blue-600/90 backdrop-blur-sm text-white text-xs px-4 py-2 rounded-full border border-blue-400/50 pointer-events-none font-medium">
          Drawing mode — click to add vertices ({geofencePoints.length} point{geofencePoints.length !== 1 ? 's' : ''})
        </div>
      )}

      {poiDropMode && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-purple-600/90 backdrop-blur-sm text-white text-xs px-4 py-2 rounded-full border border-purple-400/50 pointer-events-none font-medium">
          Click on the map to place the point of interest
        </div>
      )}

      <style>{`
        .pc-map-unit-marker {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transform: translate(-50%, -50%);
          cursor: default;
        }
        .pc-map-unit-avatar {
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: #059669;
          border: 2px solid rgba(16, 185, 129, 0.7);
          font-size: 8px;
          font-weight: 800;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.55), 0 2px 6px rgba(0,0,0,0.4);
          flex-shrink: 0;
        }
        .pc-map-unit-name {
          font-size: 10px;
          color: #d1fae5;
          background: rgba(17, 24, 39, 0.82);
          border: 1px solid rgba(16, 185, 129, 0.35);
          padding: 1px 5px;
          border-radius: 9999px;
          white-space: nowrap;
        }
        /* Active SOS — red, pulsing marker, lifted above other unit markers */
        .pc-map-unit-sos {
          z-index: 1000 !important;
        }
        .pc-map-unit-sos .pc-map-unit-avatar {
          background: #dc2626;
          border-color: rgba(248, 113, 113, 0.95);
          animation: pc-sos-pulse 1s ease-out infinite;
        }
        .pc-map-unit-sos .pc-map-unit-name {
          color: #fecaca;
          background: rgba(69, 10, 10, 0.85);
          border-color: rgba(248, 113, 113, 0.6);
        }
        @keyframes pc-sos-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.7), 0 2px 6px rgba(0,0,0,0.4); }
          70%  { box-shadow: 0 0 0 14px rgba(220, 38, 38, 0), 0 2px 6px rgba(0,0,0,0.4); }
          100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0), 0 2px 6px rgba(0,0,0,0.4); }
        }
        /* Active talker — green pulsing marker + speaker badge, lifted above others */
        .pc-map-unit-speaking {
          z-index: 1001 !important;
        }
        .pc-map-unit-speaking .pc-map-unit-avatar {
          position: relative;
          background: #16a34a;
          border-color: rgba(74, 222, 128, 0.95);
          animation: pc-speak-pulse 1.1s ease-out infinite;
        }
        .pc-map-unit-speaking .pc-map-unit-avatar::after {
          content: '🔊';
          position: absolute;
          right: -6px;
          top: -6px;
          font-size: 11px;
          line-height: 1;
          filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6));
        }
        .pc-map-unit-speaking .pc-map-unit-name {
          color: #dcfce7;
          background: rgba(5, 46, 22, 0.85);
          border-color: rgba(74, 222, 128, 0.6);
        }
        @keyframes pc-speak-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7), 0 2px 6px rgba(0,0,0,0.4); }
          70%  { box-shadow: 0 0 0 13px rgba(22, 163, 74, 0), 0 2px 6px rgba(0,0,0,0.4); }
          100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0), 0 2px 6px rgba(0,0,0,0.4); }
        }
        /* Map focus pin — distinct amber diamond (vs red SOS, blue dest) */
        .pc-map-focus-marker { transform: translateY(-2px); }
        .pc-map-focus-pin {
          width: 16px;
          height: 16px;
          background: #e67e22;
          border: 2px solid #fff;
          border-radius: 3px;
          transform: rotate(45deg);
          box-shadow: 0 0 10px rgba(230, 126, 34, 0.7), 0 2px 6px rgba(0,0,0,0.5);
        }
        /* MapLibre popup — dark theme */
        .maplibregl-popup-content {
          background: #1e2330;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 10px 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.55);
          min-width: 180px;
        }
        .maplibregl-popup-tip {
          border-top-color: #1e2330 !important;
          border-bottom-color: #1e2330 !important;
        }
        .maplibregl-popup-close-button {
          color: #9ca3af;
          font-size: 16px;
          padding: 4px 7px;
          line-height: 1;
        }
        .maplibregl-popup-close-button:hover { color: #fff; }
        /* Popup content classes */
        .pc-popup { font-family: system-ui, sans-serif; }
        .pc-popup p { margin: 0 0 4px; }
        .pc-popup-sos { font-size: 11px; font-weight: 800; letter-spacing: 0.04em; color: #fff; background: #dc2626; border-radius: 4px; padding: 2px 6px; display: inline-block; box-shadow: 0 0 10px rgba(220,38,38,0.6); }
        .pc-popup-name { font-size: 13px; font-weight: 700; color: #fff; }
        .pc-popup-call { font-size: 11px; color: #6ee7b7; }
        .pc-popup-group { font-size: 11px; color: #f59e0b; font-weight: 600; }
        .pc-popup-status { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #d1d5db; font-weight: 650; }
        .pc-popup-status span { display: inline-block; width: 7px; height: 7px; border-radius: 9999px; box-shadow: 0 0 8px currentColor; }
        .pc-popup-coords { font-size: 10px; color: #9ca3af; font-family: monospace; }
        .pc-popup-addr { font-size: 11px; color: #e5e7eb; word-break: break-word; }
        .pc-popup-meta { font-size: 10px; color: #6b7280; }
        .pc-popup-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
        .pc-popup-action {
          border: 1px solid rgba(245, 158, 11, 0.45);
          border-radius: 8px;
          background: rgba(245, 158, 11, 0.12);
          color: #fed7aa;
          cursor: pointer;
          font-size: 10px;
          font-weight: 700;
          padding: 5px 6px;
        }
        .pc-popup-action:hover { background: rgba(245, 158, 11, 0.24); color: #fff7ed; }
        /* Destination pin */
        .pc-map-dest-marker { cursor: pointer; }
        .pc-map-dest-pin {
          width: 18px;
          height: 18px;
          border-radius: 50% 50% 50% 0;
          background: #ef4444;
          border: 3px solid #fff;
          transform: rotate(-45deg);
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        }
        .pc-popup-directions-link {
          display: inline-block;
          margin-top: 6px;
          font-size: 11px;
          font-weight: 600;
          color: #60a5fa;
          text-decoration: underline;
        }
        .pc-popup-directions-link:hover { color: #93c5fd; }
        /* POI markers */
        .pc-map-poi-marker {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          transform: translate(-50%, -50%);
          cursor: default;
        }
        .pc-map-poi-drop {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transform: translate(-50%, -50%);
        }
        .pc-map-poi-diamond {
          width: 16px;
          height: 16px;
          background: #a855f7;
          border: 2.5px solid #fff;
          transform: rotate(45deg);
          box-shadow: 0 0 10px rgba(168, 85, 247, 0.6), 0 2px 6px rgba(0,0,0,0.4);
        }
        .pc-map-poi-label {
          font-size: 10px;
          color: #e9d5ff;
          background: rgba(17, 24, 39, 0.82);
          border: 1px solid rgba(168, 85, 247, 0.4);
          padding: 1px 5px;
          border-radius: 9999px;
          white-space: nowrap;
        }
        /* Search result pin */
        .pc-map-search-pin { cursor: pointer; }
        .pc-map-search-teardrop {
          width: 18px;
          height: 18px;
          border-radius: 50% 50% 50% 0;
          background: #0ea5e9;
          border: 3px solid #fff;
          transform: rotate(-45deg);
          box-shadow: 0 2px 8px rgba(14, 165, 233, 0.6), 0 2px 6px rgba(0,0,0,0.4);
        }
      `}</style>
    </div>
  );
}
