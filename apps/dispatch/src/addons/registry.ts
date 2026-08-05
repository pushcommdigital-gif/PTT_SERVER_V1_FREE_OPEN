// Panel registry — the dispatch-console EXTENSION POINT (CLAUDE.md §4).
//
// The core console renders its own panels plus whatever is in this registry.
// Community Edition registers NOTHING (see ./index.ts), so the slots ship
// empty. The commercial build swaps in an add-ons index that calls
// `registerPanel()` for the paid panels — Live Audio Traffic (transcription),
// Road Traffic (traffic), Timeline (telematics), Incidents (visual
// verification) — without the core importing any of them.
//
// Registration must happen at module-load time, before the console renders:
// `main.tsx` imports the add-ons index for its side effects.

import type { ComponentType } from 'react';

export interface PanelGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelDefinition {
  /** Unique panel id. Must not collide with a core panel id. */
  id: string;
  /** Title shown in the floating panel's title bar. */
  title: string;
  /** Short label for the top tab bar. */
  label: string;
  /** lucide-react icon (or any component taking `size`). */
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Panel body. Rendered inside the standard FloatingPanel chrome. */
  component: ComponentType;
  /** Initial geometry, computed from the viewport size. */
  defaultGeometry: (vw: number, vh: number) => PanelGeometry;
  minW?: number;
  minH?: number;
  resizable?: boolean;
  maximizable?: boolean;
  /** Open on first load. Defaults to false. */
  defaultVisible?: boolean;
}

const panels: PanelDefinition[] = [];

/** Reserved by the core console — an add-on may not claim these ids. */
const CORE_PANEL_IDS = new Set([
  'sidebar', 'voiceRec', 'message', 'quickReply', 'status', 'geoFence',
  'alarmRules', 'zoneAlerts', 'trackReplay', 'incomingMessages', 'ptt', 'map',
]);

/** Register an add-on panel. Call at module load, before the console renders. */
export function registerPanel(definition: PanelDefinition): void {
  if (CORE_PANEL_IDS.has(definition.id)) {
    throw new Error(
      `[addons] panel id "${definition.id}" is reserved by the core console.`,
    );
  }
  if (panels.some((p) => p.id === definition.id)) {
    throw new Error(`[addons] panel id "${definition.id}" is already registered.`);
  }
  panels.push(definition);
}

/** Every registered add-on panel, in registration order. Empty in CE. */
export function getRegisteredPanels(): readonly PanelDefinition[] {
  return panels;
}

/** Drop all registrations. Tests only. */
export function clearRegisteredPanels(): void {
  panels.length = 0;
}
