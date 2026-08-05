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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { GripHorizontal, Maximize2, Minimize2, X, ExternalLink } from 'lucide-react';
import { PopoutWindow } from './PopoutWindow';

export interface FloatingPanelProps {
  id: string;
  title: string;
  children: ReactNode;
  defaultX: number;
  defaultY: number;
  defaultW: number;
  defaultH: number;
  minW?: number;
  minH?: number;
  onClose?: () => void;
  maximizable?: boolean;
  resizable?: boolean;
  /** Controlled position/size — set from LayoutContext */
  controlledX?: number;
  controlledY?: number;
  controlledW?: number;
  controlledH?: number;
  /** z-index managed by LayoutContext */
  zIndex?: number;
  /** Fires when panel is moved or resized (for LayoutContext sync) */
  onGeometryChange?: (x: number, y: number, w: number, h: number) => void;
  /** Fires when panel is clicked to bring to front */
  onFocus?: () => void;
  /** Extra titlebar buttons (before close) */
  titleBarExtra?: ReactNode;
}

export function FloatingPanel({
  id,
  title,
  children,
  defaultX,
  defaultY,
  defaultW,
  defaultH,
  minW = 280,
  minH = 180,
  onClose,
  maximizable = true,
  resizable = true,
  controlledX,
  controlledY,
  controlledW,
  controlledH,
  zIndex,
  onGeometryChange,
  onFocus,
  titleBarExtra,
}: FloatingPanelProps) {
  const [pos, setPos] = useState({ x: controlledX ?? defaultX, y: controlledY ?? defaultY });
  const [size, setSize] = useState({ w: controlledW ?? defaultW, h: controlledH ?? defaultH });
  const [maximized, setMaximized] = useState(false);
  const [poppedOut, setPoppedOut] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const prevRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
  } | null>(null);

  type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

  const getBounds = useCallback(() => {
    const parent = panelRef.current?.parentElement;
    return {
      w: parent?.clientWidth ?? window.innerWidth,
      h: parent?.clientHeight ?? window.innerHeight,
    };
  }, []);

  // Clamp only the SIZE to [min, workspace]. Position is deliberately NOT pinned to
  // the right/bottom edge during drag/resize, so a panel can be moved off-screen onto
  // a second monitor (the workspace can span displays — no separate browser window).
  const clampSize = useCallback((w: number, h: number) => {
    const bounds = getBounds();
    const maxW = Math.max(minW, bounds.w - 16);
    const maxH = Math.max(minH, bounds.h - 16);
    return {
      w: Math.min(Math.max(w, minW), maxW),
      h: Math.min(Math.max(h, minH), maxH),
    };
  }, [getBounds, minH, minW]);

  // Full clamp INTO the workspace — used ONLY when a panel first opens or a template
  // loads, so a panel never appears off-screen. User drag/resize is not clamped this way.
  const clampOpen = useCallback((x: number, y: number, w: number, h: number) => {
    const { w: nextW, h: nextH } = clampSize(w, h);
    const bounds = getBounds();
    return {
      x: Math.min(Math.max(0, x), Math.max(0, bounds.w - nextW)),
      y: Math.min(Math.max(0, y), Math.max(0, bounds.h - nextH)),
      w: nextW,
      h: nextH,
    };
  }, [clampSize, getBounds]);

  // Sync from controlled props when they change externally (template load)
  useEffect(() => {
    if (
      controlledX === undefined ||
      controlledY === undefined ||
      controlledW === undefined ||
      controlledH === undefined
    ) {
      return;
    }

    const next = clampOpen(controlledX, controlledY, controlledW, controlledH);
    setPos({ x: next.x, y: next.y });
    setSize({ w: next.w, h: next.h });
  }, [clampOpen, controlledH, controlledW, controlledX, controlledY]);

  const emitGeometry = useCallback(
    (x: number, y: number, w: number, h: number) => {
      onGeometryChange?.(x, y, w, h);
    },
    [onGeometryChange],
  );

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onFocus?.();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    };
    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Keep the panel within the workspace. A position:absolute panel is confined to
      // the browser window — dragging it past the edge just clips it (it can't cross
      // onto another monitor). For true multi-monitor, pop the panel out into its own
      // window instead (see the pop-out button).
      const c = clampOpen(
        drag.originX + (ev.clientX - drag.startX),
        drag.originY + (ev.clientY - drag.startY),
        size.w,
        size.h,
      );
      setPos({ x: c.x, y: c.y });
    };
    const onUp = (ev: MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (drag) {
        const c = clampOpen(
          drag.originX + (ev.clientX - drag.startX),
          drag.originY + (ev.clientY - drag.startY),
          size.w,
          size.h,
        );
        emitGeometry(c.x, c.y, size.w, size.h);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos.x, pos.y, size.w, size.h, onFocus, emitGeometry, clampOpen]);

  const startResize = useCallback((dir: ResizeDir, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (maximized) return;
    onFocus?.();

    resizeRef.current = {
      dir,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      originW: size.w,
      originH: size.h,
    };

    let lastPos = { x: pos.x, y: pos.y };
    let lastSize = { w: size.w, h: size.h };

    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      const dy = ev.clientY - r.startY;

      let nextX = r.originX;
      let nextY = r.originY;
      let nextW = r.originW;
      let nextH = r.originH;

      if (r.dir.includes('e')) nextW = r.originW + dx;
      if (r.dir.includes('s')) nextH = r.originH + dy;
      if (r.dir.includes('w')) {
        nextW = r.originW - dx;
        nextX = r.originX + dx;
      }
      if (r.dir.includes('n')) {
        nextH = r.originH - dy;
        nextY = r.originY + dy;
      }

      if (nextW < minW) {
        if (r.dir.includes('w')) nextX -= minW - nextW;
        nextW = minW;
      }
      if (nextH < minH) {
        if (r.dir.includes('n')) nextY -= minH - nextH;
        nextH = minH;
      }

      const s = clampSize(nextW, nextH);

      const b = getBounds();
      lastPos = {
        x: Math.min(Math.max(0, nextX), Math.max(0, b.w - s.w)),
        y: Math.min(Math.max(0, nextY), Math.max(0, b.h - s.h)),
      };
      lastSize = { w: s.w, h: s.h };
      setPos(lastPos);
      setSize(lastSize);
    };

    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      emitGeometry(lastPos.x, lastPos.y, lastSize.w, lastSize.h);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [clampSize, getBounds, maximized, minH, minW, pos.x, pos.y, size.h, size.w, onFocus, emitGeometry]);

  const toggleMaximize = useCallback(() => {
    if (!maximized) {
      prevRectRef.current = { x: pos.x, y: pos.y, w: size.w, h: size.h };
      setMaximized(true);
      return;
    }
    const prev = prevRectRef.current;
    if (prev) {
      setPos({ x: prev.x, y: prev.y });
      setSize({ w: prev.w, h: prev.h });
    }
    setMaximized(false);
  }, [maximized, pos.x, pos.y, size.h, size.w]);

  const handlePanelClick = useCallback(() => {
    onFocus?.();
  }, [onFocus]);

  // Popped out: render ONLY the separate window. Leaving a full-size shell
  // behind saying "opened in a separate window" defeated the point — you move a
  // panel to the second monitor to get that space back on the primary one, and
  // instead the map stayed covered by an empty rectangle. The panel's top tab
  // stays lit so it's obvious the panel is still open, and closing the
  // popped-out window re-docks it here at the same position and size.
  if (poppedOut) {
    return (
      <PopoutWindow
        title={title}
        width={size.w}
        height={size.h}
        left={typeof window !== 'undefined' ? window.screenX + pos.x : undefined}
        top={typeof window !== 'undefined' ? window.screenY + (window.outerHeight - window.innerHeight) + pos.y : undefined}
        onClose={() => setPoppedOut(false)}
      >
        {children}
      </PopoutWindow>
    );
  }

  return (
    <section
      ref={panelRef}
      id={id}
      onMouseDown={handlePanelClick}
      className="absolute rounded-xl border border-border/80 bg-bg-sidebar/92 backdrop-blur-md shadow-[0_18px_44px_rgba(0,0,0,0.42)] overflow-hidden"
      style={{
        left: maximized ? '8px' : `${pos.x}px`,
        top: maximized ? '8px' : `${pos.y}px`,
        width: maximized ? 'calc(100% - 16px)' : `${size.w}px`,
        height: maximized ? 'calc(100% - 16px)' : `${size.h}px`,
        minWidth: `${minW}px`,
        minHeight: `${minH}px`,
        zIndex: zIndex ?? 'auto',
      }}
    >
      {!maximized && resizable && (
        <>
          <div className="absolute -top-1 left-2 right-2 h-2 cursor-n-resize z-20" onMouseDown={(e) => startResize('n', e)} />
          <div className="absolute -bottom-1 left-2 right-2 h-2 cursor-s-resize z-20" onMouseDown={(e) => startResize('s', e)} />
          <div className="absolute -left-1 top-2 bottom-2 w-2 cursor-w-resize z-20" onMouseDown={(e) => startResize('w', e)} />
          <div className="absolute -right-1 top-2 bottom-2 w-2 cursor-e-resize z-20" onMouseDown={(e) => startResize('e', e)} />

          <div className="absolute -top-1 -left-1 w-3 h-3 cursor-nw-resize z-30" onMouseDown={(e) => startResize('nw', e)} />
          <div className="absolute -top-1 -right-1 w-3 h-3 cursor-ne-resize z-30" onMouseDown={(e) => startResize('ne', e)} />
          <div className="absolute -bottom-1 -left-1 w-3 h-3 cursor-sw-resize z-30" onMouseDown={(e) => startResize('sw', e)} />
          <div className="absolute -bottom-1 -right-1 w-3 h-3 cursor-se-resize z-30" onMouseDown={(e) => startResize('se', e)} />
        </>
      )}

      <header
        onMouseDown={onMouseDown}
        className="h-10 border-b border-border bg-bg-primary/85 px-3 flex items-center gap-2 cursor-move select-none"
      >
        <GripHorizontal size={14} className="text-text-secondary" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white">{title}</h3>
        <div className="flex-1" />
        {titleBarExtra}
        <button
          onClick={() => setPoppedOut((p) => !p)}
          className={`p-1 rounded hover:bg-white/10 cursor-pointer ${poppedOut ? 'text-accent' : 'text-text-secondary hover:text-white'}`}
          title={poppedOut ? 'Bring panel back into the console' : 'Pop out to a separate window (move to another monitor)'}
        >
          <ExternalLink size={13} />
        </button>
        {maximizable && !poppedOut && (
          <button
            onClick={toggleMaximize}
            className="p-1 rounded hover:bg-white/10 text-text-secondary hover:text-white cursor-pointer"
            title={maximized ? 'Restore panel size' : 'Maximize panel'}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-text-secondary hover:text-white cursor-pointer"
            title="Close panel"
          >
            <X size={13} />
          </button>
        )}
      </header>
      <div className="h-[calc(100%-2.5rem)] overflow-hidden">{children}</div>
    </section>
  );
}
