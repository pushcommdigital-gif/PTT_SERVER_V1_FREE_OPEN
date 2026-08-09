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
// Core hook/event bus — an EXTENSION POINT (see CLAUDE.md §4).
//
// The core emits lifecycle events and forgets. Private add-ons subscribe to
// react (e.g. the transcription add-on picks up 'recording:finalized' and
// queues the clip for Whisper). The core has no knowledge of any subscriber:
// there is no registry of add-ons here, no imports of add-on code, and a
// listener that throws can never break a core code path.
//
// This is deliberately NOT the WebSocket broadcast bus (`ws/broadcast.ts`),
// which pushes to connected clients. This bus is in-process and server-side.

/**
 * Core lifecycle events. Add-ons widen this by declaration merging, exactly
 * like the WS event map in @pushcomm/shared:
 *
 *   declare module '@pushcomm/api/lib/events' {
 *     interface CoreEventMap { 'trip:closed': { tripId: string } }
 *   }
 */
export interface CoreEventMap {
  /** A PTT clip finished recording and its row is final (file on disk). */
  'recording:finalized': { recordingId: string; departmentId: string };
  /** A location fix was accepted and stored. */
  'location:recorded': {
    userId: string;
    departmentId: string;
    latitude: number;
    longitude: number;
    timestamp: string;
  };
  /** An SOS was raised by a field user. */
  'sos:raised': { sosId: string; departmentId: string; userId: string };
}

export type CoreEventName = keyof CoreEventMap;

type Listener<K extends CoreEventName> = (
  payload: CoreEventMap[K],
) => void | Promise<void>;

const listeners = new Map<CoreEventName, Set<Listener<CoreEventName>>>();

/**
 * Subscribe to a core event. Returns an unsubscribe function.
 * Called by add-on registrars during `startWorkers()`.
 */
export function onCoreEvent<K extends CoreEventName>(
  event: K,
  listener: Listener<K>,
): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(listener as Listener<CoreEventName>);
  return () => {
    set!.delete(listener as Listener<CoreEventName>);
  };
}

/**
 * Emit a core event. Fire-and-forget: listeners run detached and a listener
 * that throws (or rejects) is logged and swallowed, never propagated back into
 * the core request/webhook path that emitted it.
 */
export function emitCoreEvent<K extends CoreEventName>(
  event: K,
  payload: CoreEventMap[K],
): void {
  const set = listeners.get(event);
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      const result = (listener as Listener<K>)(payload);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((err) => {
          console.error(`[events] listener for "${event}" rejected:`, err);
        });
      }
    } catch (err) {
      console.error(`[events] listener for "${event}" threw:`, err);
    }
  }
}

/** Drop every listener. Used on shutdown and in tests. */
export function clearCoreEventListeners(): void {
  listeners.clear();
}
