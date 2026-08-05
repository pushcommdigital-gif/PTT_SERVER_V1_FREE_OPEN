import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { getRegisteredPanels } from '../addons/registry';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PanelState {
  id: string;
  visible: boolean;
  docked: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
}

export type MapMode = 'background' | 'floating' | 'hidden';

export interface MapDestination {
  lat: number;
  lon: number;
}

export interface GeoFence {
  id: string;
  name: string;
  coordinates: [number, number][];
  active: boolean;
  assignedUserIds: string[] | null;
}

export interface PointOfInterest {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  radiusMeters: number;
  active: boolean;
  assignedUserIds: string[] | null;
}

/** Generic map popup content. */
export interface MapPopupContent {
  title: string;
  lines?: string[];
  accent?: string;
}

/** A point to fly the map to, optionally opening an info popup there. */
export interface MapFocus {
  lat: number;
  lon: number;
  key: string;
  popup?: MapPopupContent;
}

export interface LayoutContextValue {
  panels: Record<string, PanelState>;
  mapMode: MapMode;
  setMapMode: (mode: MapMode) => void;
  mapDestination: MapDestination | null;
  setMapDestination: (dest: MapDestination | null) => void;
  mapFocus: MapFocus | null;
  setMapFocus: (f: MapFocus | null) => void;
  showPanel: (id: string) => void;
  hidePanel: (id: string) => void;
  togglePanel: (id: string) => void;
  updatePanel: (id: string, partial: Partial<PanelState>) => void;
  bringToFront: (id: string) => void;
  resetLayout: () => void;
  saveTemplate: (name: string) => void;
  loadTemplate: (name: string) => boolean;
  deleteTemplate: (name: string) => void;
  listTemplates: () => string[];
  // Geofence drawing
  geofenceDrawMode: boolean;
  setGeofenceDrawMode: (active: boolean) => void;
  geofencePoints: [number, number][];
  addGeofencePoint: (pt: [number, number]) => void;
  clearGeofencePoints: () => void;
  // Geofences to display on map
  geofencesToDisplay: GeoFence[];
  setGeofencesToDisplay: Dispatch<SetStateAction<GeoFence[]>>;
  // Points of Interest
  poiDropMode: boolean;
  setPoiDropMode: (active: boolean) => void;
  poiDropPoint: [number, number] | null;  // [lon, lat]
  setPoiDropPoint: (pt: [number, number] | null) => void;
  poisToDisplay: PointOfInterest[];
  setPoisToDisplay: Dispatch<SetStateAction<PointOfInterest[]>>;
}

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

const STORAGE_PREFIX = 'pushcomm:layout:';

let _z = 10;
const nextZ = () => ++_z;

const defaultPanel = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  visible = false,
  docked = false,
): PanelState => ({
  id,
  visible,
  docked,
  x,
  y,
  w,
  h,
  zIndex: nextZ(),
});

function buildDefaults(): Record<string, PanelState> {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const core: Record<string, PanelState> = {
    sidebar: defaultPanel('sidebar', 0, 0, 320, vh - 140, true, true),
    voiceRec: defaultPanel('voiceRec', 360, 60, 620, 500, false),
    message: defaultPanel('message', 340, 60, Math.min(980, Math.max(760, vw - 520)), Math.min(620, Math.max(460, vh - 220)), false),
    quickReply: defaultPanel('quickReply', Math.max(360, vw - 580), Math.max(80, vh - 620), 520, 520, false),
    status: defaultPanel('status', Math.max(340, vw - 470), 70, 420, 560, false),
    geoFence: defaultPanel('geoFence', 400, 100, 500, 400, false),
    alarmRules: defaultPanel('alarmRules', vw - 360, 60, 320, 500, false),
    zoneAlerts: defaultPanel('zoneAlerts', vw - 700, 60, 320, 500, false),
    trackReplay: defaultPanel('trackReplay', 360, 70, Math.min(900, Math.max(680, vw - 460)), Math.min(640, Math.max(460, vh - 200)), false),
    incomingMessages: defaultPanel('incomingMessages', Math.max(340, vw - 440), Math.max(120, vh - 420), 400, 300, true),
    ptt: defaultPanel('ptt', Math.floor(vw / 2) - 150, vh - 220, 300, 110, true),
    map: defaultPanel('map', 340, 60, vw - 380, vh - 200, false),
  };

  // EXTENSION POINT: add-on panels contribute their own default geometry.
  // Empty in Community Edition.
  for (const def of getRegisteredPanels()) {
    const g = def.defaultGeometry(vw, vh);
    core[def.id] = defaultPanel(def.id, g.x, g.y, g.w, g.h, def.defaultVisible ?? false);
  }

  return core;
}

interface LayoutSnapshot {
  panels: Record<string, PanelState>;
  mapMode: MapMode;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within a LayoutProvider');
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<Record<string, PanelState>>(buildDefaults);
  const [mapMode, setMapModeState] = useState<MapMode>('background');
  const [mapDestination, setMapDestination] = useState<MapDestination | null>(null);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const [geofenceDrawMode, setGeofenceDrawMode] = useState(false);
  const [geofencePoints, setGeofencePoints] = useState<[number, number][]>([]);
  const [geofencesToDisplay, setGeofencesToDisplay] = useState<GeoFence[]>([]);
  const [poiDropMode, setPoiDropMode] = useState(false);
  const [poiDropPoint, setPoiDropPoint] = useState<[number, number] | null>(null);
  const [poisToDisplay, setPoisToDisplay] = useState<PointOfInterest[]>([]);

  const setMapMode = useCallback((mode: MapMode) => {
    setMapModeState(mode);
    // When switching to floating, make map panel visible
    if (mode === 'floating') {
      setPanels((prev) => ({
        ...prev,
        map: { ...prev.map, visible: true, zIndex: nextZ() },
      }));
    }
  }, []);

  const showPanel = useCallback((id: string) => {
    setPanels((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], visible: true, zIndex: nextZ() } };
    });
  }, []);

  const hidePanel = useCallback((id: string) => {
    setPanels((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], visible: false } };
    });
  }, []);

  const togglePanel = useCallback((id: string) => {
    setPanels((prev) => {
      if (!prev[id]) return prev;
      const p = prev[id];
      return {
        ...prev,
        [id]: { ...p, visible: !p.visible, zIndex: !p.visible ? nextZ() : p.zIndex },
      };
    });
  }, []);

  const updatePanel = useCallback((id: string, partial: Partial<PanelState>) => {
    setPanels((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], ...partial } };
    });
  }, []);

  const bringToFront = useCallback((id: string) => {
    setPanels((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], zIndex: nextZ() } };
    });
  }, []);

  const resetLayout = useCallback(() => {
    _z = 10;
    setPanels(buildDefaults());
    setMapModeState('background');
  }, []);

  const addGeofencePoint = useCallback((pt: [number, number]) => {
    setGeofencePoints((prev) => [...prev, pt]);
  }, []);

  const clearGeofencePoints = useCallback(() => {
    setGeofencePoints([]);
  }, []);

  /* ---------- template persistence ---------- */

  const saveTemplate = useCallback(
    (name: string) => {
      const snapshot: LayoutSnapshot = { panels, mapMode };
      try {
        localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(snapshot));
      } catch {
        /* quota exceeded — ignore */
      }
    },
    [panels, mapMode],
  );

  const loadTemplate = useCallback((name: string): boolean => {
    const raw = localStorage.getItem(STORAGE_PREFIX + name);
    if (!raw) return false;
    try {
      const snapshot: LayoutSnapshot = JSON.parse(raw);
      setPanels(snapshot.panels);
      setMapModeState(snapshot.mapMode);
      return true;
    } catch {
      return false;
    }
  }, []);

  const deleteTemplate = useCallback((name: string) => {
    localStorage.removeItem(STORAGE_PREFIX + name);
  }, []);

  const listTemplates = useCallback((): string[] => {
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) {
        names.push(key.slice(STORAGE_PREFIX.length));
      }
    }
    return names.sort();
  }, []);

  const value = useMemo<LayoutContextValue>(
    () => ({
      panels,
      mapMode,
      setMapMode,
      mapDestination,
      setMapDestination,
      mapFocus,
      setMapFocus,
      showPanel,
      hidePanel,
      togglePanel,
      updatePanel,
      bringToFront,
      resetLayout,
      saveTemplate,
      loadTemplate,
      deleteTemplate,
      listTemplates,
      geofenceDrawMode,
      setGeofenceDrawMode,
      geofencePoints,
      addGeofencePoint,
      clearGeofencePoints,
      geofencesToDisplay,
      setGeofencesToDisplay,
      poiDropMode,
      setPoiDropMode,
      poiDropPoint,
      setPoiDropPoint,
      poisToDisplay,
      setPoisToDisplay,
    }),
    [
      panels,
      mapMode,
      setMapMode,
      mapDestination,
      setMapDestination,
      mapFocus,
      setMapFocus,
      showPanel,
      hidePanel,
      togglePanel,
      updatePanel,
      bringToFront,
      resetLayout,
      saveTemplate,
      loadTemplate,
      deleteTemplate,
      listTemplates,
      geofenceDrawMode,
      setGeofenceDrawMode,
      geofencePoints,
      addGeofencePoint,
      clearGeofencePoints,
      geofencesToDisplay,
      setGeofencesToDisplay,
      poiDropMode,
      setPoiDropMode,
      poiDropPoint,
      setPoiDropPoint,
      poisToDisplay,
      setPoisToDisplay,
    ],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}
