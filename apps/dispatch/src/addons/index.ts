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
// Add-ons index — Community Edition.
//
// This file is INTENTIONALLY EMPTY. CE is the core console with no paid panels
// registered; the commercial build replaces this module with one that imports
// its private panels and calls `registerPanel()` for each:
//
//   import { registerPanel } from './registry';
//   import { LiveAudioTrafficPanel } from '@pushcomm/addons/transcription';
//   registerPanel({ id: 'liveAudio', title: 'Live Audio Traffic', ... });
//
// Do not add core panels here — those are rendered directly by DispatchConsole.
// Imported for side effects by `main.tsx`.

export {};
