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
import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { getAccessToken } from '../lib/api';
import type { WsEventName } from '@pushcomm/shared';

type WsStatus = 'connecting' | 'connected' | 'disconnected';
type Listener = (data: any) => void;

interface WsContextValue {
  status: WsStatus;
  subscribe: (event: WsEventName, listener: Listener) => () => void;
}

const WsContext = createContext<WsContextValue | null>(null);

const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<WsStatus>('disconnected');
  const listenersRef = useRef(new Map<WsEventName, Set<Listener>>());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectDelay = useRef(RECONNECT_BASE);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token || !mountedRef.current) return;

    // Build WS URL relative to current page
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`;

    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setStatus('connected');
      reconnectDelay.current = RECONNECT_BASE;
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const eventName = data.event as WsEventName;
        const set = listenersRef.current.get(eventName);
        if (set) {
          for (const fn of set) fn(data);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      setStatus('disconnected');
      // Schedule reconnect
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX);
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, []);

  // Connect when authenticated, disconnect when not
  useEffect(() => {
    mountedRef.current = true;

    if (isAuthenticated) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus('disconnected');
    };
  }, [isAuthenticated, connect]);

  const subscribe = useCallback((event: WsEventName, listener: Listener) => {
    let set = listenersRef.current.get(event);
    if (!set) {
      set = new Set();
      listenersRef.current.set(event, set);
    }
    set.add(listener);

    return () => {
      set!.delete(listener);
      if (set!.size === 0) listenersRef.current.delete(event);
    };
  }, []);

  return (
    <WsContext.Provider value={{ status, subscribe }}>
      {children}
    </WsContext.Provider>
  );
}

/** Subscribe to a specific WS event. Callback fires on each event. */
export function useWsEvent(event: WsEventName, callback: Listener) {
  const ctx = useContext(WsContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(event, (data) => callbackRef.current(data));
  }, [ctx, event]);
}

/** Get the current WS connection status. */
export function useWsStatus(): WsStatus {
  const ctx = useContext(WsContext);
  return ctx?.status ?? 'disconnected';
}
