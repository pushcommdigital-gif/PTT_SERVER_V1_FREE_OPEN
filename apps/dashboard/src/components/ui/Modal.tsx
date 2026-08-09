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
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

// Track how many modals are currently open so body.overflow is only released
// when the LAST one closes. Prevents one closing modal from re-enabling scroll
// while another is still open, and (more importantly) ensures overflow is
// reliably reset back to '' even across mount/unmount race conditions.
let openModalCount = 0;
function lockBody() {
  if (openModalCount === 0) document.body.style.overflow = 'hidden';
  openModalCount += 1;
}
function unlockBody() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) document.body.style.overflow = '';
}

export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Body scroll lock + ESC handler. Depends ONLY on `open`, not on `onClose`,
  // so this effect runs exactly once per open/close transition. Without this,
  // an inline `onClose={() => ...}` in the parent re-creates the function each
  // render and forces this effect to re-fire continuously, which has caused
  // stuck-backdrop bugs in the past.
  useEffect(() => {
    if (!open) return;
    lockBody();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('keydown', handleEsc);
      unlockBody();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-lg border border-border bg-bg-card/95 px-3 py-2 text-xs font-medium text-text-secondary shadow-lg transition-colors hover:text-white"
      >
        Close
      </button>
      <div className={`my-auto flex max-h-[calc(100vh-2rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
