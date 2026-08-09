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
import { useCallback, useEffect, useRef, useState } from 'react';
import { LogIn, LogOut, MapPin, X } from 'lucide-react';
import { useWsEvent } from '../contexts/WebSocketContext';

type AlertKind = 'geofence' | 'poi';

interface AlertToast {
  id: number;
  kind: AlertKind;
  zoneName: string;
  userName: string;
  type: 'enter' | 'exit';
  timestamp: string;
}

let _toastId = 0;

const AUTO_DISMISS_MS = 8000;

export function AlertToasts() {
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const add = useCallback((toast: Omit<AlertToast, 'id'>) => {
    const id = ++_toastId;
    setToasts((prev) => [{ ...toast, id }, ...prev].slice(0, 8));
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, AUTO_DISMISS_MS);
    timersRef.current.set(id, timer);
  }, []);

  const dismiss = useCallback((id: number) => {
    clearTimeout(timersRef.current.get(id));
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => { for (const t of timers.values()) clearTimeout(t); };
  }, []);

  useWsEvent('geofence:alert', (e: any) => {
    add({
      kind: 'geofence',
      zoneName: e.geofenceName ?? 'Unknown zone',
      userName: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Unknown',
      type: e.type,
      timestamp: e.timestamp ?? new Date().toISOString(),
    });
  });

  useWsEvent('poi:alert', (e: any) => {
    add({
      kind: 'poi',
      zoneName: e.poiName ?? 'Unknown POI',
      userName: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Unknown',
      type: e.type,
      timestamp: e.timestamp ?? new Date().toISOString(),
    });
  });

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 right-3 z-[9998] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 300 }}>
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: AlertToast; onDismiss: () => void }) {
  const isEnter = toast.type === 'enter';
  const isGeofence = toast.kind === 'geofence';

  const borderColor = isEnter ? 'border-green-400/80' : 'border-orange-400/80';
  const iconColor = isEnter ? 'text-green-300' : 'text-orange-300';
  const textColor = isEnter ? 'text-green-200' : 'text-orange-200';
  const badgeColor = isGeofence
    ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
    : 'bg-purple-500/20 text-purple-300 border-purple-500/30';
  const cardStyle = {
    animation: 'slideInRight 0.2s ease-out',
    background: isEnter
      ? 'linear-gradient(135deg, rgba(2, 44, 34, 0.94), rgba(6, 78, 59, 0.88))'
      : 'linear-gradient(135deg, rgba(67, 20, 7, 0.94), rgba(124, 45, 18, 0.88))',
    boxShadow: isEnter
      ? '0 18px 40px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(74, 222, 128, 0.18), 0 0 24px rgba(34, 197, 94, 0.20)'
      : '0 18px 40px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(251, 146, 60, 0.18), 0 0 24px rgba(249, 115, 22, 0.20)',
  };

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 backdrop-blur-md ${borderColor}`}
      style={cardStyle}
    >
      <div className={`shrink-0 mt-0.5 ${iconColor}`}>
        {isEnter ? <LogIn size={14} /> : <LogOut size={14} />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border ${badgeColor} flex items-center gap-1`}>
            {isGeofence ? null : <MapPin size={8} />}
            {isGeofence ? 'Geo-fence' : 'POI'}
          </span>
          <span className={`text-[10px] font-bold ${textColor}`}>
            {isEnter ? 'ENTERED' : 'EXITED'}
          </span>
        </div>
        <p className="text-xs font-semibold text-white truncate">{toast.userName}</p>
        <p className="text-[10px] text-white/75 truncate">"{toast.zoneName}"</p>
        <p className="text-[9px] text-white/55 mt-0.5">
          {new Date(toast.timestamp).toLocaleTimeString()}
        </p>
      </div>

      <button
        onClick={onDismiss}
        className="shrink-0 text-text-secondary/40 hover:text-text-secondary transition-colors mt-0.5"
      >
        <X size={12} />
      </button>
    </div>
  );
}
