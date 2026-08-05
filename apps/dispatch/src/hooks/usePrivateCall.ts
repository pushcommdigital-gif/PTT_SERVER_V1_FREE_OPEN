import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, Track, RemoteTrackPublication } from 'livekit-client';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useWsEvent } from '../contexts/WebSocketContext';

export interface PrivateCallFloor {
  held: boolean;
  holderId: string | null;
  holderName: string | null;
}

export interface PrivateCallState {
  isActive: boolean;
  targetUserId: string | null;
  targetName: string;
  isPttActive: boolean;
  participantCount: number;
  floor: PrivateCallFloor;
}

const CLEARED_FLOOR: PrivateCallFloor = { held: false, holderId: null, holderName: null };

const INITIAL_STATE: PrivateCallState = {
  isActive: false,
  targetUserId: null,
  targetName: '',
  isPttActive: false,
  participantCount: 0,
  floor: CLEARED_FLOOR,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function usePrivateCall() {
  const { user } = useAuth();
  const [state, setState] = useState<PrivateCallState>(INITIAL_STATE);

  const roomRef = useRef<Room | null>(null);
  const isPttRef = useRef(false);
  const targetUserIdRef = useRef<string | null>(null);

  const canCaptureAudio =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  // ── connect: shared logic for joining a private room ─────────────────────
  const connectRoom = useCallback(async (token: string, livekitUrl: string, roomName: string) => {
    // Disconnect any existing private call first
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    let url = livekitUrl;
    if (window.location.protocol === 'https:' && url.startsWith('ws://')) {
      url = `wss://${window.location.host}/livekit`;
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    // Floor control via data channel
    room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      try {
        const msg = JSON.parse(decoder.decode(payload));
        if (msg.type === 'floor:granted') {
          setState((prev) => ({
            ...prev,
            floor: { held: true, holderId: msg.userId, holderName: msg.userName },
          }));
        } else if (msg.type === 'floor:released') {
          setState((prev) => ({ ...prev, floor: CLEARED_FLOOR }));
        }
      } catch { /* ignore */ }
    });

    // Incoming audio
    room.on(RoomEvent.TrackSubscribed, (track, pub: RemoteTrackPublication) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLMediaElement;
        el.id = `private-audio-${pub.trackSid}`;
        el.autoplay = true;
        el.muted = false;
        document.body.appendChild(el);
        el.play().catch(() => {});
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((el) => el.remove());
      }
    });

    // Release floor if holder disconnects
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      setState((prev) => {
        if (prev.floor.holderId === participant.identity) {
          return { ...prev, floor: CLEARED_FLOOR };
        }
        return prev;
      });
    });

    // Participant count
    const updateCount = () => {
      setState((prev) => ({ ...prev, participantCount: room.remoteParticipants.size + 1 }));
    };
    room.on(RoomEvent.ParticipantConnected, updateCount);
    room.on(RoomEvent.ParticipantDisconnected, updateCount);

    // Remote hang-up / disconnect
    room.on(RoomEvent.Disconnected, () => {
      roomRef.current = null;
      isPttRef.current = false;
      setState(INITIAL_STATE);
    });

    roomRef.current = room;
    await room.connect(url, token);

    // Pre-warm mic
    if (canCaptureAudio) {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch { /* not critical */ }
    }

    setState((prev) => ({ ...prev, participantCount: room.remoteParticipants.size + 1 }));
  }, [canCaptureAudio]);

  // ── startCall: initiator side ─────────────────────────────────────────────
  const startCall = useCallback(async (targetUserId: string, targetName: string) => {
    if (!user) return;
    targetUserIdRef.current = targetUserId;
    setState({ ...INITIAL_STATE, isActive: true, targetUserId, targetName });

    try {
      const res = await apiFetch<{
        token: string; livekitUrl: string; roomName: string;
        targetFirstName: string; targetLastName: string;
      }>('/private-calls/token', {
        method: 'POST',
        body: JSON.stringify({ targetUserId, notify: true }),
      });
      if (!res.data) throw new Error('No token data');
      await connectRoom(res.data.token, res.data.livekitUrl, res.data.roomName);
    } catch (err) {
      setState(INITIAL_STATE);
      targetUserIdRef.current = null;
    }
  }, [user, connectRoom]);

  // ── acceptCall: recipient side (no notify — caller already knows) ─────────
  const acceptCall = useCallback(async (initiatorId: string, initiatorName: string) => {
    if (!user) return;
    targetUserIdRef.current = initiatorId;
    setState({ ...INITIAL_STATE, isActive: true, targetUserId: initiatorId, targetName: initiatorName });

    try {
      const res = await apiFetch<{
        token: string; livekitUrl: string; roomName: string;
        targetFirstName: string; targetLastName: string;
      }>('/private-calls/token', {
        method: 'POST',
        body: JSON.stringify({ targetUserId: initiatorId, notify: false }),
      });
      if (!res.data) throw new Error('No token data');
      await connectRoom(res.data.token, res.data.livekitUrl, res.data.roomName);
    } catch (err) {
      setState(INITIAL_STATE);
      targetUserIdRef.current = null;
    }
  }, [user, connectRoom]);

  // ── hangUp ────────────────────────────────────────────────────────────────
  const hangUp = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      if (isPttRef.current) {
        room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
        room.localParticipant.publishData(
          encoder.encode(JSON.stringify({ type: 'floor:released' })),
          { reliable: true },
        );
      }
      room.disconnect();
      roomRef.current = null;
    }
    // Signal the other party
    const tid = targetUserIdRef.current;
    if (tid) {
      apiFetch('/private-calls/end', {
        method: 'POST',
        body: JSON.stringify({ targetUserId: tid }),
      }).catch(() => {});
    }
    isPttRef.current = false;
    targetUserIdRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // ── requestFloor / releaseFloor ───────────────────────────────────────────
  const requestFloor = useCallback(() => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected' || !user) return;
    if (!canCaptureAudio) return;
    if (state.floor.held && state.floor.holderId !== user.id) return;

    const userName = `${user.firstName} ${user.lastName}`;
    room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
    isPttRef.current = true;
    setState((prev) => ({
      ...prev,
      isPttActive: true,
      floor: { held: true, holderId: user.id, holderName: userName },
    }));
    room.localParticipant.publishData(
      encoder.encode(JSON.stringify({ type: 'floor:granted', userId: user.id, userName })),
      { reliable: true },
    );
  }, [user, canCaptureAudio, state.floor]);

  const releaseFloor = useCallback(() => {
    const room = roomRef.current;
    if (!room || !isPttRef.current || !user) return;

    room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    isPttRef.current = false;
    setState((prev) => ({ ...prev, isPttActive: false, floor: CLEARED_FLOOR }));
    room.localParticipant.publishData(
      encoder.encode(JSON.stringify({ type: 'floor:released' })),
      { reliable: true },
    );
  }, [user]);

  // ── Handle incoming call from WS ──────────────────────────────────────────
  useWsEvent('private_call:incoming', (data: any) => {
    if (!user || data.targetUserId !== user.id) return;
    if (state.isActive) return; // already in a call
    const initiatorName = `${data.initiatorFirstName ?? ''} ${data.initiatorLastName ?? ''}`.trim() || 'Unknown';
    acceptCall(data.initiatorId, initiatorName);
  });

  // ── Handle remote hang-up ────────────────────────────────────────────────
  useWsEvent('private_call:ended', (data: any) => {
    if (!state.isActive) return;
    if (data.targetUserId !== user?.id && data.endedBy !== user?.id) return;
    // The other party ended the call
    if (data.endedBy !== user?.id) {
      const room = roomRef.current;
      if (room) { room.disconnect(); roomRef.current = null; }
      isPttRef.current = false;
      targetUserIdRef.current = null;
      setState(INITIAL_STATE);
    }
  });

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
    };
  }, []);

  return { state, startCall, acceptCall, hangUp, requestFloor, releaseFloor };
}
