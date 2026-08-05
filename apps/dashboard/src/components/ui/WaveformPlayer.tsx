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
import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Loader2, AlertCircle } from 'lucide-react';

const ACCENT = '#e67e22';

// Minimal shape the player needs — satisfied by both a full VoiceRecording (Recordings
// page) and a CDR clip (PttClip), since both are rows of voice_recordings.
interface PlayableRecording {
  id: string;
  filePath: string | null;
  status: string;
  durationSec: number | null;
}

interface Props {
  rec: PlayableRecording;
}

function getStreamUrl(recId: string) {
  const token = localStorage.getItem('accessToken');
  return `/api/voice-recordings/${recId}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

function formatTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function WaveformPlayer({ rec }: Props) {
  // Use a JSX <audio> element via ref — more reliable than new Audio() for in-browser playback
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const peaksRef = useRef<Float32Array | null>(null);
  const hoverRatioRef = useRef<number | null>(null);

  const [loadingWave, setLoadingWave] = useState(false);
  const [waveError, setWaveError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(rec.durationSec ?? 0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    const peaks = peaksRef.current;
    if (!canvas) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (W === 0 || H === 0) return;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, W, H);

    if (!peaks || peaks.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, Math.floor(H / 2) - 1, W, 2);
      return;
    }

    const progress = audio && audio.duration > 0 && isFinite(audio.duration) ? audio.currentTime / audio.duration : 0;
    const playedX = progress * W;
    const midY = H / 2;
    const barW = W / peaks.length;

    for (let i = 0; i < peaks.length; i++) {
      const x = i * barW;
      const barH = Math.max(2, peaks[i] * H * 0.80);
      ctx.globalAlpha = x + barW <= playedX ? 1.0 : 0.28;
      ctx.fillStyle = ACCENT;
      ctx.fillRect(
        Math.floor(x),
        Math.floor(midY - barH / 2),
        Math.max(1, Math.floor(barW) - 1),
        Math.ceil(barH),
      );
    }
    ctx.globalAlpha = 1;

    if (playedX > 1) {
      ctx.fillStyle = `${ACCENT}12`;
      ctx.fillRect(0, 0, playedX, H);
    }

    if (audio && audio.duration > 0 && playedX > 0) {
      const px = Math.floor(playedX);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - 1, 0, 2, H);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(px, 5, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, H - 5, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hoverRatioRef.current !== null) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(Math.floor(hoverRatioRef.current * W), 0, 1, H);
    }
  }, []);

  // RAF loop while playing
  useEffect(() => {
    if (isPlaying) {
      const loop = () => {
        const audio = audioRef.current;
        if (audio) setCurrentTime(audio.currentTime);
        draw();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(rafRef.current);
    } else {
      cancelAnimationFrame(rafRef.current);
      draw();
    }
  }, [isPlaying, draw]);

  // Decode waveform when rec changes (audio src is handled by the <audio> element directly)
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(rec.durationSec ?? 0);
    peaksRef.current = null;
    setWaveError(null);
    setLoadingWave(false);

    if (!rec.filePath || rec.status !== 'ready') {
      setTimeout(draw, 0);
      return;
    }

    const url = getStreamUrl(rec.id);
    setLoadingWave(true);
    const controller = new AbortController();

    fetch(url, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(async buf => {
        const ActxClass = window.AudioContext || (window as any).webkitAudioContext;
        const actx = new ActxClass() as AudioContext;
        await actx.resume();
        try {
          const decoded = await actx.decodeAudioData(buf);
          actx.close();
          return decoded;
        } catch (decodeErr) {
          actx.close();
          throw decodeErr;
        }
      })
      .then(decoded => {
        const ch = decoded.getChannelData(0);
        const NUM_BARS = 400;
        const blockSize = Math.max(1, Math.floor(ch.length / NUM_BARS));
        const peaks = new Float32Array(NUM_BARS);
        for (let i = 0; i < NUM_BARS; i++) {
          let max = 0;
          const start = i * blockSize;
          const end = Math.min(start + blockSize, ch.length);
          for (let j = start; j < end; j++) {
            const a = Math.abs(ch[j]);
            if (a > max) max = a;
          }
          peaks[i] = max;
        }
        let globalMax = 0;
        for (let i = 0; i < peaks.length; i++) if (peaks[i] > globalMax) globalMax = peaks[i];
        if (globalMax > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= globalMax;
        peaksRef.current = peaks;
        setLoadingWave(false);
        draw();
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error('[WaveformPlayer] decode error:', err);
          setWaveError('Waveform unavailable');
          setLoadingWave(false);
          draw();
        }
      });

    return () => {
      controller.abort();
      cancelAnimationFrame(rafRef.current);
    };
  }, [rec.id, draw]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.error('[WaveformPlayer] play error:', err));
    }
  }

  function seek(ratio: number) {
    const audio = audioRef.current;
    if (!audio || !audio.duration || !isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, ratio * audio.duration));
    setCurrentTime(audio.currentTime);
    if (!isPlaying) draw();
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    seek((e.clientX - rect.left) / rect.width);
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const audio = audioRef.current;
    if (!audio || !audio.duration || !isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + e.deltaY * 0.03));
    setCurrentTime(audio.currentTime);
    if (!isPlaying) draw();
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    hoverRatioRef.current = ratio;
    const dur = audioRef.current?.duration || duration;
    setHoverX(x);
    setHoverTime(ratio * dur);
    if (!isPlaying) draw();
  }

  function handleMouseLeave() {
    hoverRatioRef.current = null;
    setHoverX(null);
    setHoverTime(null);
    if (!isPlaying) draw();
  }

  const url = (rec.filePath && rec.status === 'ready') ? getStreamUrl(rec.id) : undefined;
  const canPlay = !!url;

  return (
    <div className="space-y-4">
      {/* Hidden audio element — browser manages loading/buffering */}
      <audio
        ref={audioRef}
        src={url}
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (audio) setDuration(audio.duration);
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (audio && !isPlaying) setCurrentTime(audio.currentTime);
        }}
        onEnded={() => {
          setIsPlaying(false);
          const audio = audioRef.current;
          if (audio) setCurrentTime(audio.duration);
          draw();
        }}
        onError={(e) => {
          console.error('[WaveformPlayer] audio element error:', e);
          setIsPlaying(false);
        }}
      />

      {/* Controls row */}
      <div className="flex items-center gap-4">
        <button
          onClick={togglePlay}
          disabled={!canPlay}
          className="w-10 h-10 rounded-full bg-accent hover:bg-accent/80 flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <div className="text-sm font-mono">
          <span className="text-white">{formatTime(currentTime)}</span>
          <span className="text-text-secondary mx-1">/</span>
          <span className="text-text-secondary">{formatTime(duration)}</span>
        </div>
        {loadingWave && (
          <div className="flex items-center gap-1.5 text-text-secondary ml-auto">
            <Loader2 size={13} className="animate-spin" />
            <span className="text-xs">Decoding…</span>
          </div>
        )}
        {waveError && (
          <div className="flex items-center gap-1.5 text-text-secondary ml-auto">
            <AlertCircle size={13} />
            <span className="text-xs">{waveError}</span>
          </div>
        )}
      </div>

      {/* Waveform canvas */}
      <div className="relative rounded-lg overflow-hidden" style={{ height: 120 }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ cursor: canPlay && !loadingWave ? 'crosshair' : 'default' }}
          onClick={handleCanvasClick}
          onWheel={handleWheel}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {hoverX !== null && hoverTime !== null && (
          <div
            className="absolute top-2 pointer-events-none bg-black/75 text-white text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{ left: hoverX, transform: 'translateX(-50%)' }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
        {canPlay && !loadingWave && !waveError && (
          <div className="absolute bottom-1.5 right-2 text-xs text-white/20 pointer-events-none select-none">
            click to seek · scroll to scrub
          </div>
        )}
      </div>
    </div>
  );
}
