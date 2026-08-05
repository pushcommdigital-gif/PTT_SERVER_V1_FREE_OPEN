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
import { useState, useEffect, useCallback } from 'react';
import { createLevelMeter, type LevelMeter } from '../lib/audioLevel';

// Enumerate the machine's audio input devices. Labels are only populated once the
// site has been granted mic permission (the dispatcher's PTT already does this);
// until then the picker shows a generic name.
export function useAudioInputs() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'audioinput'));
    } catch { /* enumeration unavailable */ }
  }, []);

  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => md?.removeEventListener?.('devicechange', refresh);
  }, [refresh]);

  return { devices, refresh };
}

// Live 0..1 input level for a chosen mic, using its OWN getUserMedia stream (so it
// works as a "mic check" independent of whether PTT is transmitting). Only holds the
// stream while `enabled` is true, to avoid keeping the mic-in-use indicator lit.
export function useMicMeter(deviceId: string | null, enabled: boolean) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) { setLevel(0); setError(null); return; }
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let meter: LevelMeter | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        meter = createLevelMeter(stream);
        const tick = () => {
          if (stopped || !meter) return;
          setLevel(meter.read());
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Microphone unavailable');
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      meter?.close();
      stream?.getTracks().forEach((t) => t.stop());
      setLevel(0);
    };
  }, [deviceId, enabled]);

  return { level, error };
}
