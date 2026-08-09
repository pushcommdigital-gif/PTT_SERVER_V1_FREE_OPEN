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
import { useState, useRef, useCallback, useEffect } from 'react';
import { apiFetch } from '../lib/api';

export interface TrackPoint {
  lat: number;
  lon: number;
  ts: string; // ISO
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
}

export interface TrackUser {
  userId: string;
  displayName: string;
  callsign: string;
  points: TrackPoint[];
}

export type PlaybackSpeed = 1 | 2 | 4 | 8;

export interface InterpolatedPosition {
  lat: number;
  lon: number;
  heading: number | null;
  speed: number | null;
}

/** Linear interpolation between two GPS fixes. */
function interpolatePosition(
  points: TrackPoint[],
  replayMs: number,
): InterpolatedPosition | null {
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];

  if (replayMs <= new Date(first.ts).getTime()) {
    return { lat: first.lat, lon: first.lon, heading: first.heading, speed: first.speed };
  }
  if (replayMs >= new Date(last.ts).getTime()) {
    return { lat: last.lat, lon: last.lon, heading: last.heading, speed: last.speed };
  }

  // Binary search for the bracket
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (new Date(points[mid].ts).getTime() <= replayMs) lo = mid;
    else hi = mid;
  }

  const a = points[lo];
  const b = points[hi];
  const tA = new Date(a.ts).getTime();
  const tB = new Date(b.ts).getTime();
  const ratio = tB === tA ? 0 : (replayMs - tA) / (tB - tA);

  return {
    lat: a.lat + ratio * (b.lat - a.lat),
    lon: a.lon + ratio * (b.lon - a.lon),
    heading: a.heading,
    speed: a.speed,
  };
}

export function useTrackReplay() {
  const [tracks, setTracks] = useState<TrackUser[]>([]);
  const [windowFrom, setWindowFrom] = useState<Date | null>(null);
  const [windowTo, setWindowTo] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replayMs, setReplayMs] = useState(0); // ms from windowFrom
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayMsRef = useRef(0);
  const windowFromMsRef = useRef(0);
  const windowDurationMsRef = useRef(0);

  // Keep ref in sync for the interval callback
  useEffect(() => { replayMsRef.current = replayMs; }, [replayMs]);

  const load = useCallback(async (userIds: string[], from: Date, to: Date) => {
    if (userIds.length === 0) return;
    setLoading(true);
    setError(null);
    setIsPlaying(false);
    setReplayMs(0);

    try {
      const params = new URLSearchParams();
      userIds.forEach((id) => params.append('userId[]', id));
      params.set('from', from.toISOString());
      params.set('to', to.toISOString());

      const res = await apiFetch<{
        tracks: TrackUser[];
        from: string;
        to: string;
      }>(`/locations/track?${params.toString()}`);

      if (!res.success || !res.data) throw new Error(res.error ?? 'Load failed');

      setTracks(res.data.tracks);
      const f = new Date(res.data.from);
      const t = new Date(res.data.to);
      setWindowFrom(f);
      setWindowTo(t);
      windowFromMsRef.current = f.getTime();
      windowDurationMsRef.current = t.getTime() - f.getTime();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load track');
    } finally {
      setLoading(false);
    }
  }, []);

  // Playback interval — advances replayMs by tick * speed every 100ms
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!isPlaying || windowDurationMsRef.current === 0) return;

    intervalRef.current = setInterval(() => {
      const next = replayMsRef.current + 100 * speed;
      if (next >= windowDurationMsRef.current) {
        setReplayMs(windowDurationMsRef.current);
        setIsPlaying(false);
      } else {
        setReplayMs(next);
      }
    }, 100);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed]);

  const seekTo = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(windowDurationMsRef.current, ms));
    setReplayMs(clamped);
  }, []);

  const seekToDate = useCallback((date: Date) => {
    seekTo(date.getTime() - windowFromMsRef.current);
  }, [seekTo]);

  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);

  const replayDate = windowFrom ? new Date(windowFrom.getTime() + replayMs) : null;
  const totalDurationMs = windowFrom && windowTo ? windowTo.getTime() - windowFrom.getTime() : 0;

  /** Current interpolated position for each user. */
  const currentPositions: Record<string, InterpolatedPosition> = {};
  if (windowFrom) {
    const absMs = windowFrom.getTime() + replayMs;
    for (const track of tracks) {
      const pos = interpolatePosition(track.points, absMs);
      if (pos) currentPositions[track.userId] = pos;
    }
  }

  return {
    // data
    tracks,
    windowFrom,
    windowTo,
    totalDurationMs,
    loading,
    error,
    // playback state
    replayMs,
    replayDate,
    isPlaying,
    speed,
    // computed
    currentPositions,
    // actions
    load,
    seekTo,
    seekToDate,
    togglePlay,
    setSpeed,
  };
}
