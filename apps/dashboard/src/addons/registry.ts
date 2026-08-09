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
// Route/nav registry — the dashboard EXTENSION POINT (CLAUDE.md §4).
//
// The core dashboard renders its own routes plus whatever is in this registry.
// Community Edition registers NOTHING (see ./index.ts), so the slots ship
// empty. The commercial build swaps in an add-ons index that calls
// `registerRoute()` for the paid pages — Keyword Alerts (transcription),
// Incidents/Evidence (visual verification), App Updates (OTA), Backups,
// License — without the core importing any of them.
//
// Registration must happen at module-load time, before the app renders:
// `main.tsx` imports the add-ons index for its side effects.

import type { ComponentType } from 'react';

export interface AddonRoute {
  /** Path relative to the dashboard root, no leading slash (e.g. 'backups'). */
  path: string;
  /** Page component, rendered inside the standard authenticated Layout. */
  component: ComponentType;
  /** Sidebar entry. Omit to register a route with no nav item. */
  nav?: {
    label: string;
    icon: ComponentType<{ size?: number; className?: string }>;
    /** Which sidebar section to appear under. */
    section: 'operations' | 'management' | 'system';
    /** Minimum role level required to see the entry (see @pushcomm/shared). */
    minRoleLevel?: number;
    /** Sort key within the section. Lower sorts first. Defaults to 100. */
    order?: number;
  };
}

const routes: AddonRoute[] = [];

/** Paths owned by the core dashboard — an add-on may not claim these. */
const CORE_PATHS = new Set([
  '', 'users', 'users/roles', 'devices', 'groups', 'groups/types', 'statuses',
  'sos', 'zone-alerts', 'cdr', 'settings', 'voice-channels', 'audio-library',
]);

/** Register an add-on route. Call at module load, before the app renders. */
export function registerRoute(route: AddonRoute): void {
  const path = route.path.replace(/^\/+/, '');
  if (CORE_PATHS.has(path)) {
    throw new Error(`[addons] route "${path}" is reserved by the core dashboard.`);
  }
  if (routes.some((r) => r.path === path)) {
    throw new Error(`[addons] route "${path}" is already registered.`);
  }
  routes.push({ ...route, path });
}

/** Every registered add-on route, in registration order. Empty in CE. */
export function getRegisteredRoutes(): readonly AddonRoute[] {
  return routes;
}

/** Nav entries for one sidebar section, sorted. Empty in CE. */
export function getRegisteredNav(section: NonNullable<AddonRoute['nav']>['section']) {
  return routes
    .filter((r) => r.nav?.section === section)
    .sort((a, b) => (a.nav!.order ?? 100) - (b.nav!.order ?? 100));
}

/** Drop all registrations. Tests only. */
export function clearRegisteredRoutes(): void {
  routes.length = 0;
}
