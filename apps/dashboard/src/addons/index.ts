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
// Add-ons index — Community Edition.
//
// This file is INTENTIONALLY EMPTY. CE is the core dashboard with no paid pages
// registered; the commercial build replaces this module with one that imports
// its private pages and calls `registerRoute()` for each:
//
//   import { registerRoute } from './registry';
//   import { BackupsPage } from '@pushcomm/addons/backups';
//   registerRoute({ path: 'backups', component: BackupsPage, nav: { ... } });
//
// Do not add core pages here — those are declared directly in App.tsx.
// Imported for side effects by `main.tsx`.

export {};
