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
import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, Mic } from 'lucide-react';
import { useVoice } from '../../contexts/VoiceContext';
import { useAudioInputs, useMicMeter } from '../../hooks/useMicDevices';

// Segmented VU bar. `level` is 0..1 RMS; scaled perceptually so quiet speech still
// registers. Turns amber/green as it rises; stays dark when the mic is silent.
export function LevelBar({ level, segments = 12 }: { level: number; segments?: number }) {
  const scaled = Math.min(1, Math.sqrt(level) * 1.4); // perceptual boost
  const lit = Math.round(scaled * segments);
  return (
    <div className="flex items-center gap-[2px] h-3">
      {Array.from({ length: segments }).map((_, i) => {
        const on = i < lit;
        const color = i > segments * 0.85 ? '#ef4444' : i > segments * 0.6 ? '#f59d29' : '#10b981';
        return (
          <span
            key={i}
            className="flex-1 h-full rounded-[1px] transition-colors"
            style={{ backgroundColor: on ? color : 'rgba(255,255,255,0.10)' }}
          />
        );
      })}
    </div>
  );
}

// Shared mic picker + live "is my mic actually working?" test. `enabled` gates the
// self-contained test meter (it opens its own stream on the selected device), so a
// dead/hijacked mic is obvious before keying up. Reused in the PTT popover and the
// Settings panel.
export function MicPicker({ enabled }: { enabled: boolean }) {
  const voice = useVoice();
  const { devices } = useAudioInputs();
  const { level, error } = useMicMeter(voice.selectedMicId, enabled);

  return (
    <div>
      <select
        value={voice.selectedMicId ?? ''}
        onChange={(e) => { void voice.setMicDevice(e.target.value); }}
        className="w-full bg-bg-primary border border-border rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-accent mb-2"
      >
        <option value="">System default</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </select>

      <div className="mb-1.5">
        <LevelBar level={level} />
      </div>

      {error ? (
        <p className="text-[10px] text-red-400 leading-snug">{error}</p>
      ) : (
        <p className="text-[10px] text-text-secondary leading-snug">
          Speak now — the bar should move. If it stays flat, this mic isn't being
          captured (check Windows sound settings or close any screen-recording app
          holding the mic).
        </p>
      )}
    </div>
  );
}

// Mic picker + test in a compact popover for the PTT widget.
export function MicSettingsButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Fixed-position anchor: the PTT panel clips overflow, so the popover is portaled
  // to <body> and positioned just above the button.
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, r.right - 256), bottom: window.innerHeight - r.top + 8 });
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className={`p-1 rounded transition-colors cursor-pointer shrink-0 ${open ? 'text-accent bg-accent/15' : 'text-text-secondary hover:text-white hover:bg-white/10'}`}
        title="Microphone settings & test"
      >
        <Settings2 size={13} />
      </button>

      {open && pos && createPortal(
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-[900]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[901] w-64 bg-bg-card border border-border rounded-lg shadow-2xl p-3"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Mic size={12} className="text-accent" />
              <span className="text-xs font-semibold text-white">Microphone</span>
            </div>
            <MicPicker enabled={open} />
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
