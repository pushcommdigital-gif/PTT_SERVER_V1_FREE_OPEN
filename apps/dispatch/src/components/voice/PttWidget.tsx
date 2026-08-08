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
import { useCallback, useEffect } from 'react';
import { Mic, MicOff, Radio, Users, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import { useVoice } from '../../contexts/VoiceContext';
import { MicSettingsButton, LevelBar } from './MicSettings';
import { useGroups } from '../../hooks/useGroups';
import { useAuth } from '../../contexts/AuthContext';
import type { PrivateCallState } from '../../hooks/usePrivateCall';

interface PttWidgetProps {
  variant?: 'compact' | 'command';
  talkTargets?: {
    users: Array<{ id: string; name: string }>;
    groups: Array<{ id: string; name: string }>;
  };
  broadcast?: boolean;
  privateCall?: {
    state: PrivateCallState;
    onRequestFloor: () => void;
    onReleaseFloor: () => void;
    onHangUp: () => void;
  };
}

export function PttWidget({ variant = 'compact', talkTargets, broadcast, privateCall }: PttWidgetProps) {
  const { user } = useAuth();
  const voice = useVoice();
  const { groups, loading } = useGroups({ page: 1, limit: 200, search: '' });
  const selectedUsers = talkTargets?.users || [];
  const selectedGroups = talkTargets?.groups || [];
  const selectedCount = selectedUsers.length + selectedGroups.length;

  const handleChannelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const channelId = e.target.value;
      if (channelId === '') {
        voice.leaveChannel();
      } else {
        voice.joinChannel(channelId);
      }
    },
    [voice],
  );

  const handlePttDown = useCallback(() => {
    if (!voice.isConnected) return;
    voice.requestFloor();
  }, [voice]);

  const handlePttUp = useCallback(() => {
    if (!voice.isPttActive) return;
    voice.releaseFloor();
  }, [voice]);

  const handleMonitorAll = useCallback(() => {
    const monitorTargets = groups.map((group) => ({ id: group.id, name: group.name }));
    const txTargets = selectedGroups
      .map((selectedGroup) => {
        const byId = monitorTargets.find((group) => group.id === selectedGroup.id);
        const byName = monitorTargets.find(
          (group) => group.name.trim().toLowerCase() === selectedGroup.name.trim().toLowerCase(),
        );
        return byId || byName || null;
      })
      .filter((group): group is { id: string; name: string } => Boolean(group));

    void (async () => {
      await voice.monitorGroups(monitorTargets);
      if (txTargets.length > 0) {
        await voice.setTransmitChannels(txTargets);
      }
    })();
  }, [groups, selectedGroups, voice]);

  const handleMonitorNone = useCallback(() => {
    voice.stopMonitoringGroups(groups.map((group) => group.id));
  }, [groups, voice]);

  // Floor status
  const isMyFloor = voice.floor.held && voice.floor.holderId === user?.id;
  const otherHoldsFloor = voice.floor.held && voice.floor.holderId !== user?.id;

  // PTT button color
  let pttBg = 'bg-accent/30';
  let pttText = 'text-text-secondary';
  if (voice.isConnected && !voice.floor.held) {
    pttBg = 'bg-accent hover:bg-accent-hover';
    pttText = 'text-white';
  }
  if (isMyFloor) {
    pttBg = 'bg-accent-hover animate-pulse';
    pttText = 'text-white';
  }
  if (otherHoldsFloor) {
    pttBg = 'bg-red-600/80';
    pttText = 'text-white';
  }

  // Floor status text
  let statusText = '';
  if (voice.isConnecting) {
    statusText = 'Connecting...';
  } else if (isMyFloor) {
    statusText = 'TX';
  } else if (otherHoldsFloor) {
    const groupLabel = voice.floor.groupName ? `[${voice.floor.groupName}] ` : '';
    statusText = `${groupLabel}${voice.floor.holderName || 'Busy'}`;
  } else if (voice.isConnected) {
    statusText = 'Free';
  }

  const currentChannelName = voice.isBroadcastTransmit
    ? 'All Call'
    : voice.currentChannelId
      ? groups.find((g) => g.id === voice.currentChannelId)?.name || 'Connected'
      : 'No TX Group';

  useEffect(() => {
    if (loading) return;
    const selected = talkTargets?.groups ?? [];
    const targetGroups = selected
      .map((selectedGroup) => {
        const byId = groups.find((g) => g.id === selectedGroup.id);
        const byName = groups.find((g) => g.name.trim().toLowerCase() === selectedGroup.name.trim().toLowerCase());
        const target = byId || byName;
        return target ? { id: target.id, name: target.name } : null;
      })
      .filter((group): group is { id: string; name: string } => Boolean(group));

    if (voice.isBroadcastTransmit !== Boolean(broadcast)) {
      void voice.setBroadcastTransmit(Boolean(broadcast));
    }

    const currentKey = voice.transmitChannelIds.join(',');
    const nextKey = targetGroups.map((group) => group.id).join(',');
    if (!broadcast && currentKey !== nextKey) {
      void voice.setTransmitChannels(targetGroups);
    }
  }, [broadcast, groups, loading, talkTargets, voice]);

  // ── Private call derived state ────────────────────────────────────────────
  const pc = privateCall;

  // Auto-unmute group audio when private call ends
  const isCallActive = pc?.state.isActive ?? false;
  useEffect(() => {
    if (!isCallActive && voice.groupAudioMuted) {
      voice.setGroupAudioMuted(false);
    }
  }, [isCallActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const pcFloorLabel = pc?.state.isPttActive
    ? 'TX'
    : pc?.state.floor.held
      ? `${pc.state.floor.holderName ?? 'Remote'} talking`
      : 'Floor free';

  const pcFloorColor = pc?.state.isPttActive
    ? 'text-accent'
    : pc?.state.floor.held
      ? 'text-red-400'
      : 'text-emerald-400';

  // ── Compact variant ───────────────────────────────────────────────────────
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        {/* Group selector */}
        <div className="flex items-center gap-1">
          <Radio size={12} className="text-text-secondary shrink-0" />
          <select
            value={voice.currentChannelId || ''}
            onChange={handleChannelChange}
            disabled={loading || voice.isConnecting}
            className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-accent min-w-[90px] disabled:opacity-50"
          >
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        {/* Participant count */}
        {voice.isConnected && (
          <div className="flex items-center gap-0.5 text-text-secondary">
            <Users size={10} />
            <span className="text-[10px]">{voice.participantCount}</span>
          </div>
        )}

        {/* PTT Button */}
        <button
          onMouseDown={handlePttDown}
          onMouseUp={handlePttUp}
          onMouseLeave={handlePttUp}
          onTouchStart={(e) => { e.preventDefault(); handlePttDown(); }}
          onTouchEnd={(e) => { e.preventDefault(); handlePttUp(); }}
          disabled={!voice.isConnected || otherHoldsFloor}
          className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors select-none cursor-pointer disabled:cursor-not-allowed ${pttBg} ${pttText}`}
          title={voice.isConnected ? 'Push to Talk (or hold Space)' : 'Select a group first'}
        >
          {voice.isConnected ? <Mic size={14} /> : <MicOff size={14} />}
          <span className="text-[10px] font-semibold uppercase">PTT</span>
        </button>

        {/* Floor status */}
        {statusText && (
          <span
            className={`text-[10px] font-medium truncate max-w-[120px] ${
              isMyFloor ? 'text-accent' : otherHoldsFloor ? 'text-red-400' : 'text-emerald-400'
            }`}
            title={statusText}
          >
            {statusText}
          </span>
        )}
      </div>
    );
  }

  // ── Command variant ───────────────────────────────────────────────────────
  return (
    <div className="p-2.5 flex flex-col gap-0">
      {/* Group PTT row */}
      <div className="flex items-center gap-3">
        {/* PTT button */}
        <button
          onMouseDown={handlePttDown}
          onMouseUp={handlePttUp}
          onMouseLeave={handlePttUp}
          onTouchStart={(e) => { e.preventDefault(); handlePttDown(); }}
          onTouchEnd={(e) => { e.preventDefault(); handlePttUp(); }}
          disabled={!voice.isConnected || otherHoldsFloor}
          className={`relative w-14 h-14 rounded-full border-2 border-white/50 transition-all duration-150 select-none cursor-pointer disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(0,0,0,0.4)] shrink-0 ${
            voice.isConnected && !otherHoldsFloor
              ? 'bg-gradient-to-b from-[#ffbe52] via-[#f59d29] to-[#e97b10] active:scale-95'
              : 'bg-gradient-to-b from-[#7a6648] via-[#6f573b] to-[#5f4a31] opacity-90'
          } ${isMyFloor ? 'scale-95 ring-3 ring-accent/40' : ''}`}
          title={voice.isConnected ? 'Push to Talk (or hold Space)' : 'Select a group from the sidebar first'}
        >
          <span className={`inline-flex flex-col items-center justify-center w-full h-full gap-0.5 ${pttText}`}>
            {voice.isConnected ? <Mic size={16} /> : <MicOff size={16} />}
            <span className="text-[10px] font-extrabold uppercase">PTT</span>
          </span>
        </button>

        {/* Group info */}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white truncate">
            {voice.transmitChannelIds.length > 1
              ? voice.isBroadcastTransmit
                ? 'All Call'
                : `TX ${voice.transmitChannelIds.length} groups`
              : currentChannelName}
          </p>
          <p className="text-[11px] text-text-secondary truncate">
            {isMyFloor ? (
              <span className="text-accent animate-pulse">Transmitting...</span>
            ) : otherHoldsFloor ? (
              <span className="text-red-300">
                Speaking:{' '}
                {voice.floor.groupName && <span className="font-medium">[{voice.floor.groupName}]</span>}{' '}
                <span className="text-white font-semibold">{voice.floor.holderName || 'Another user'}</span>
              </span>
            ) : broadcast ? (
              <span className="text-red-300 font-medium">Broadcast All</span>
            ) : selectedCount > 0 ? (
              <span className="text-accent">
                {selectedGroups.length > 0 && `${selectedGroups.length} group${selectedGroups.length !== 1 ? 's' : ''}`}
                {selectedGroups.length > 0 && selectedUsers.length > 0 && ' + '}
                {selectedUsers.length > 0 && `${selectedUsers.length} user${selectedUsers.length !== 1 ? 's' : ''}`}
              </span>
            ) : (
              <span>Monitoring {voice.monitoredGroupIds.size || 'all'} groups · select TX target</span>
            )}
          </p>
          {voice.lastError && (
            <p className="text-[10px] text-red-400 truncate">Error: {voice.lastError}</p>
          )}
          {/* Live input level while transmitting. */}
          {isMyFloor && (
            <div className="mt-1 pr-1">
              <LevelBar level={voice.micLevel} />
            </div>
          )}
          {/* A flat level bar already indicated a dead microphone, but only to
              someone who knew to look at it. Say it outright instead: an
              operator transmitting into a silent mic sees the floor granted and
              everything else behave normally, so nothing tells them nobody can
              hear a word. */}
          {isMyFloor && voice.micSilent && (
            <p className="mt-1 text-[10px] font-semibold text-red-400 leading-snug">
              No sound from your microphone — nobody can hear you. Check the mic
              picker below.
            </p>
          )}
        </div>
      </div>

      {/* Private call row — shown inside the same panel when a 1:1 call is active */}
      <div className="mt-2 pt-2 border-t border-border/70 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-text-secondary">Monitor</p>
          <p className="text-[11px] text-white truncate">
            {voice.monitoredGroupIds.size}/{groups.length || 0} groups listening
          </p>
        </div>
        <button
          onClick={handleMonitorAll}
          disabled={loading || groups.length === 0}
          className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          Monitor All
        </button>
        <button
          onClick={handleMonitorNone}
          disabled={loading || groups.length === 0}
          className="px-2 py-1 rounded bg-bg-primary/70 text-text-secondary text-[10px] font-semibold border border-border hover:text-white disabled:opacity-50"
        >
          Quiet
        </button>
        <MicSettingsButton />
      </div>

      {pc?.state.isActive && (
        <div className="mt-2 pt-2 border-t border-border flex items-center gap-2">
          {/* Live indicator + name */}
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
          <span className="text-[11px] font-semibold text-white truncate min-w-0 flex-1">
            {pc.state.targetName || 'Private Call'}
          </span>
          {pc.state.participantCount > 0 && (
            <span className="text-[10px] text-text-secondary shrink-0">
              · {pc.state.participantCount}
            </span>
          )}

          {/* Floor status */}
          <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${pcFloorColor}`}>
            {pcFloorLabel}
          </span>

          {/* PTT */}
          <button
            onMouseDown={pc.onRequestFloor}
            onMouseUp={pc.onReleaseFloor}
            onMouseLeave={pc.onReleaseFloor}
            onTouchStart={(e) => { e.preventDefault(); pc.onRequestFloor(); }}
            onTouchEnd={(e) => { e.preventDefault(); pc.onReleaseFloor(); }}
            disabled={pc.state.floor.held && !pc.state.isPttActive}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-all select-none cursor-pointer disabled:cursor-not-allowed shrink-0 ${
              pc.state.isPttActive
                ? 'bg-accent text-white scale-95'
                : pc.state.floor.held
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-accent/20 text-accent hover:bg-accent/30'
            }`}
          >
            <Mic size={11} />
            PTT
          </button>

          {/* Group audio mute toggle */}
          <button
            onClick={() => voice.setGroupAudioMuted(!voice.groupAudioMuted)}
            className={`p-1 rounded transition-colors cursor-pointer shrink-0 ${
              voice.groupAudioMuted
                ? 'text-red-400 bg-red-500/20'
                : 'text-text-secondary hover:text-white hover:bg-white/10'
            }`}
            title={voice.groupAudioMuted ? 'Unmute group audio' : 'Mute group audio'}
          >
            {voice.groupAudioMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>

          {/* Hang up */}
          <button
            onClick={pc.onHangUp}
            className="p-1 rounded text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer shrink-0"
            title="End private call"
          >
            <PhoneOff size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
