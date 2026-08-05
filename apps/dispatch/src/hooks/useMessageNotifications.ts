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
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useWsEvent } from '../contexts/WebSocketContext';
import { useSettings, type MessageAlertVolume } from '../contexts/SettingsContext';
import type { ConversationsData } from '@pushcomm/shared';

/**
 * Handles incoming message notifications for the dispatch console.
 *
 * - Requests browser Notification permission once on mount
 * - Shows an OS-level notification (with sender name) when the tab is not focused
 * - Tracks an unread badge count and resets it when the Messages panel is opened
 *
 * Returns the current unread count to display as a badge on the Messages tab button.
 */
export function useMessageNotifications(
  userId: string | undefined,
  conversations: ConversationsData,
): number {
  const { messageSoundEnabled, messageAlertVolume } = useSettings();
  const audioContextRef = useRef<AudioContext | null>(null);

  const unreadCount = useMemo(() => {
    const directUnread = conversations.direct.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    const groupUnread = conversations.group.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    const broadcastUnread = conversations.broadcast.reduce((sum, c) => sum + (c.is_read ? 0 : 1), 0);
    return directUnread + groupUnread + broadcastUnread;
  }, [conversations]);

  // Keep a live ref to conversations so the WS handler always has the latest data
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  // Request browser notification permission once after login
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useWsEvent('message:created', (data: any) => {
    if (!userId || data.senderId === userId) return;

    if (messageSoundEnabled) {
      playMessageAlert(audioContextRef, messageAlertVolume);
    }

    // Only show OS notification when the tab is not in focus
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return;

    // Look up sender name from already-loaded direct conversations
    const convo = conversationsRef.current.direct.find(
      (c) => c.partner_id === data.senderId,
    );
    const senderName = convo
      ? `${convo.partner_first_name} ${convo.partner_last_name}`.trim()
      : 'Someone';

    new Notification(`New message from ${senderName}`, {
      body: convo?.last_message ?? 'Tap to open PushComm',
      icon: '/favicon.ico',
      tag: 'pushcomm-message', // replaces previous notification instead of stacking
    });
  });

  return unreadCount;
}

const alertProfiles: Record<MessageAlertVolume, {
  masterGain: number;
  toneGain: number;
  frequencies: number[];
  toneLength: number;
  toneSpacing: number;
  repeat: number;
}> = {
  low: {
    masterGain: 0.42,
    toneGain: 0.75,
    frequencies: [1200, 1800],
    toneLength: 0.15,
    toneSpacing: 0.14,
    repeat: 1,
  },
  medium: {
    masterGain: 0.7,
    toneGain: 0.9,
    frequencies: [1400, 2200, 3000],
    toneLength: 0.18,
    toneSpacing: 0.13,
    repeat: 1,
  },
  high: {
    masterGain: 0.95,
    toneGain: 1,
    frequencies: [1700, 2600, 3600, 2400],
    toneLength: 0.22,
    toneSpacing: 0.12,
    repeat: 2,
  },
};

function playMessageAlert(audioContextRef: MutableRefObject<AudioContext | null>, volume: MessageAlertVolume) {
  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const ctx = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = ctx;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const profile = alertProfiles[volume] ?? alertProfiles.high;
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, now);
    compressor.knee.setValueAtTime(12, now);
    compressor.ratio.setValueAtTime(4, now);
    compressor.attack.setValueAtTime(0.003, now);
    compressor.release.setValueAtTime(0.18, now);

    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(profile.masterGain, now + 0.012);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.repeat * 0.64);
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);

    // 1-4 kHz square-wave chirps cut through typical laptop speakers better
    // than lower, softer tones. High repeats once for noisy dispatch rooms.
    for (let cycle = 0; cycle < profile.repeat; cycle += 1) {
      const cycleOffset = cycle * 0.62;
      for (const [index, frequency] of profile.frequencies.entries()) {
        const oscillator = ctx.createOscillator();
        const toneGain = ctx.createGain();
        const startsAt = now + cycleOffset + index * profile.toneSpacing;
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(frequency, startsAt);
        toneGain.gain.setValueAtTime(0.0001, startsAt);
        toneGain.gain.exponentialRampToValueAtTime(profile.toneGain, startsAt + 0.008);
        toneGain.gain.exponentialRampToValueAtTime(0.0001, startsAt + profile.toneLength);
        oscillator.connect(toneGain);
        toneGain.connect(masterGain);
        oscillator.start(startsAt);
        oscillator.stop(startsAt + profile.toneLength + 0.02);
      }
    }
  } catch {
    // Browser audio permissions vary; visual alerts still work if sound is blocked.
  }
}
