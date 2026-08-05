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
// Tiny Web Audio helper: turn a MediaStream into a 0..1 RMS level reader. Used by
// the PTT mic meter + device test so a dead/silent microphone is visible instead of
// the dispatcher unknowingly transmitting silence.

export interface LevelMeter {
  /** Current RMS amplitude, 0 (silence) .. ~1 (loud). Read on each animation frame. */
  read(): number;
  close(): void;
}

export function createLevelMeter(stream: MediaStream): LevelMeter {
  const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  // A context created off a user gesture (e.g. the transmit meter attaches in a
  // retry timeout after the floor grant) starts suspended → the analyser reads a
  // flat line. Resume it; within the gesture's sticky-activation window this works.
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  return {
    read() {
      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128; // -1..1
        sumSq += v * v;
      }
      return Math.sqrt(sumSq / buf.length);
    },
    close() {
      try { source.disconnect(); } catch { /* already gone */ }
      ctx.close().catch(() => { /* ignore */ });
    },
  };
}
