import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import {
  Room,
  RoomEvent,
  Track,
  RemoteTrackPublication,
  RemoteParticipant,
} from 'livekit-client';
import { apiFetch } from '../lib/api';
import { useAuth } from './AuthContext';
import { createLevelMeter, type LevelMeter } from '../lib/audioLevel';

const MIC_ID_KEY = 'pushcomm.dispatch.micId';

interface FloorGranted {
  type: 'floor:granted';
  userId: string;
  userName: string;
}

interface FloorReleased {
  type: 'floor:released';
}

type FloorMessage = FloorGranted | FloorReleased;

export interface FloorState {
  held: boolean;
  holderId: string | null;
  holderName: string | null;
  /** Which group room the floor holder is speaking on */
  groupId: string | null;
  groupName: string | null;
}

interface VoiceContextValue {
  /** The group selected for transmitting (null = monitoring only) */
  currentChannelId: string | null;
  /** All groups currently selected for transmitting */
  transmitChannelIds: string[];
  /** Groups currently monitored for incoming audio */
  monitoredGroupIds: Set<string>;
  /** Active transmit channel is connected and ready */
  isConnected: boolean;
  isConnecting: boolean;
  lastError: string | null;
  /** Set the active transmit group; auto-joins the monitor room if needed */
  joinChannel: (channelId: string) => Promise<void>;
  /** Set one or more transmit groups; auto-joins monitor rooms if needed */
  setTransmitChannels: (groups: GroupListItem[]) => Promise<void>;
  /** Route PTT through the department-wide All Call room instead of group rooms */
  setBroadcastTransmit: (enabled: boolean) => Promise<void>;
  /** Clear the active transmit target (keeps monitoring all rooms) */
  leaveChannel: () => void;
  monitorGroups: (groups: GroupListItem[]) => Promise<void>;
  stopMonitoringGroups: (groupIds: string[]) => void;
  floor: FloorState;
  requestFloor: () => void;
  releaseFloor: () => void;
  isPttActive: boolean;
  isBroadcastTransmit: boolean;
  /** Participant count in the active transmit channel */
  participantCount: number;
  /** Whether incoming group audio is locally muted */
  groupAudioMuted: boolean;
  setGroupAudioMuted: (muted: boolean) => void;
  /** Selected microphone deviceId (null = OS default) */
  selectedMicId: string | null;
  /** Switch the capture mic across all rooms + persist the choice */
  setMicDevice: (deviceId: string) => Promise<void>;
  /** Live 0..1 input level of the published mic while transmitting (0 when idle) */
  micLevel: number;
}

type GroupListItem = { id: string; name: string };

const VoiceCtx = createContext<VoiceContextValue | null>(null);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CLEARED_FLOOR: FloorState = { held: false, holderId: null, holderName: null, groupId: null, groupName: null };

// Lead-in: egress (the clip recorder) needs a moment to actually start capturing
// after LiveKit accepts the request, so we keep the mic muted briefly after the
// grant beep — otherwise the first syllable is lost from the recording (and the
// transcript). The beep is the "talk after the tone" cue. Tune against real clip
// starts; 200ms is a floor, 250-300ms may be needed.
const LEAD_IN_MS = 200;

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // All currently monitored rooms: groupId â†’ Room
  const monitorRoomsRef = useRef<Map<string, Room>>(new Map());
  // Group display names for floor status
  const groupNamesRef = useRef<Map<string, string>>(new Map());
  // The room we are currently transmitting on (one of the monitored rooms)
  const activeRoomRef = useRef<Room | null>(null);
  // Department-wide All Call room used for true broadcast PTT.
  const broadcastRoomRef = useRef<Room | null>(null);
  // Stable refs to avoid stale closures in callbacks
  const currentChannelIdRef = useRef<string | null>(null);
  const transmitChannelIdsRef = useRef<string[]>([]);
  const broadcastTransmitRef = useRef(false);
  const floorRef = useRef<FloorState>(CLEARED_FLOOR);
  const isPttActiveRef = useRef(false);
  // Cleanup fn for participant-count listeners on the active room
  const countCleanupRef = useRef<(() => void) | null>(null);

  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  const [transmitChannelIds, setTransmitChannelIds] = useState<string[]>([]);
  const [isBroadcastTransmit, setIsBroadcastTransmit] = useState(false);
  const [monitoredGroupIds, setMonitoredGroupIds] = useState<Set<string>>(new Set());
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [floor, setFloor] = useState<FloorState>(CLEARED_FLOOR);
  const [isPttActive, setIsPttActive] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [groupAudioMuted, setGroupAudioMutedState] = useState(false);
  const groupAudioMutedRef = useRef(false);
  // Selected capture mic (persisted). Applied to new rooms via audioCaptureDefaults
  // and to live rooms via switchActiveDevice. null = OS default.
  const [selectedMicId, setSelectedMicId] = useState<string | null>(() => {
    try { return localStorage.getItem(MIC_ID_KEY); } catch { return null; }
  });
  const selectedMicIdRef = useRef<string | null>(selectedMicId);
  useEffect(() => { selectedMicIdRef.current = selectedMicId; }, [selectedMicId]);
  // Live input level of the actually-published mic track while transmitting.
  const [micLevel, setMicLevel] = useState(0);
  // Phase 3B: server is the single source of truth for floor + recording.
  // The client posts to /api/voice/floor/request (mic stays muted) and
  // unmutes only after capture: 'started' arrives. Plays a courtesy beep
  // before unmute so the user hears "you can talk now".
  const lastFloorRequestIdRef = useRef<string | null>(null);
  const beepCtxRef = useRef<AudioContext | null>(null);

  /** ~150 ms 800 Hz tone via Web Audio. Created lazily on first call. */
  const playGrantBeep = useCallback(() => {
    try {
      if (!beepCtxRef.current) {
        const Ctx = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext;
        beepCtxRef.current = new Ctx();
      }
      const ctx = beepCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch { /* audio failure should never block PTT */ }
  }, []);

  // Keep stable refs in sync with state
  useEffect(() => { currentChannelIdRef.current = currentChannelId; }, [currentChannelId]);
  useEffect(() => { transmitChannelIdsRef.current = transmitChannelIds; }, [transmitChannelIds]);
  useEffect(() => { floorRef.current = floor; }, [floor]);
  useEffect(() => { isPttActiveRef.current = isPttActive; }, [isPttActive]);

  const canCaptureAudio =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  // ── setMicDevice: switch capture mic everywhere + persist ─────────────────
  const setMicDevice = useCallback(async (deviceId: string) => {
    setSelectedMicId(deviceId);
    selectedMicIdRef.current = deviceId;
    try { localStorage.setItem(MIC_ID_KEY, deviceId); } catch { /* ignore */ }
    const rooms: Room[] = [];
    if (broadcastRoomRef.current) rooms.push(broadcastRoomRef.current);
    for (const room of monitorRoomsRef.current.values()) rooms.push(room);
    await Promise.allSettled(
      rooms.map((room) =>
        room.state === 'connected'
          ? room.switchActiveDevice('audioinput', deviceId)
          : Promise.resolve(),
      ),
    );
  }, []);

  // ── Transmit-time mic meter: analyse the ACTUAL published track so a silent
  // mic shows a flat bar. Read-only; never blocks PTT. The track appears shortly
  // after the lead-in unmute, so we retry until it exists. ────────────────────
  useEffect(() => {
    if (!isPttActive) { setMicLevel(0); return; }
    let stopped = false;
    let raf = 0;
    let tries = 0;
    let meter: LevelMeter | null = null;
    // The mic publication can live on any room we're transmitting on; scan them all
    // (broadcast + monitor rooms) for a live local mic track.
    const findMicTrack = (): MediaStreamTrack | null => {
      const rooms: Room[] = [];
      if (broadcastRoomRef.current) rooms.push(broadcastRoomRef.current);
      for (const room of monitorRoomsRef.current.values()) rooms.push(room);
      for (const room of rooms) {
        try {
          const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          const mst = pub?.track?.mediaStreamTrack ?? pub?.audioTrack?.mediaStreamTrack;
          if (mst && mst.readyState === 'live' && !pub?.isMuted) return mst;
        } catch { /* try next room */ }
      }
      return null;
    };
    const tick = () => {
      if (stopped || !meter) return;
      setMicLevel(meter.read());
      raf = requestAnimationFrame(tick);
    };
    const attach = () => {
      if (stopped) return;
      const mst = findMicTrack();
      if (mst) {
        try { meter = createLevelMeter(new MediaStream([mst])); tick(); return; } catch { /* retry */ }
      }
      if (tries++ < 40) setTimeout(attach, 150); // ~6s window for the track to publish
    };
    attach();
    return () => { stopped = true; cancelAnimationFrame(raf); meter?.close(); setMicLevel(0); };
  }, [isPttActive]);

  // â”€â”€ sendDataMessage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const sendDataMessage = useCallback((room: Room, msg: FloorMessage) => {
    if (room.state !== 'connected') return;
    room.localParticipant.publishData(encoder.encode(JSON.stringify(msg)), { reliable: true });
  }, []);

  const attachRoomHandlers = useCallback((room: Room, groupId: string, groupName: string | null) => {
    room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      try {
        const msg = JSON.parse(decoder.decode(payload)) as FloorMessage;
        if (msg.type === 'floor:granted') {
          const f: FloorState = { held: true, holderId: msg.userId, holderName: msg.userName, groupId, groupName };
          floorRef.current = f;
          setFloor(f);
        } else if (msg.type === 'floor:released') {
          setFloor(prev => {
            if (prev.groupId !== groupId) return prev;
            floorRef.current = CLEARED_FLOOR;
            return CLEARED_FLOOR;
          });
        }
      } catch { /* ignore malformed */ }
    });

    room.on(RoomEvent.TrackSubscribed, (track, pub: RemoteTrackPublication) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLMediaElement;
        el.id = `audio-${groupId}-${pub.trackSid}`;
        el.autoplay = true;
        el.muted = groupAudioMutedRef.current;
        (el as any).playsInline = true;
        document.body.appendChild(el);
        el.play().catch(() => {
          const resume = () => { el.play().catch(() => {}); };
          document.addEventListener('click', resume, { once: true });
          document.addEventListener('keydown', resume, { once: true });
        });
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((el) => el.remove());
      }
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      setFloor(prev => {
        if (prev.holderId === participant.identity && prev.groupId === groupId) {
          floorRef.current = CLEARED_FLOOR;
          return CLEARED_FLOOR;
        }
        return prev;
      });
    });
  }, []);

  const normalizeLivekitUrl = useCallback((rawUrl: string) => {
    if (window.location.protocol === 'https:' && rawUrl.startsWith('ws://')) {
      return `wss://${window.location.host}/livekit`;
    }
    return rawUrl;
  }, []);

  const joinBroadcastRoom = useCallback(async (): Promise<Room | null> => {
    const existing = broadcastRoomRef.current;
    if (existing) return existing;

    try {
      const res = await apiFetch<{ token: string; livekitUrl: string; roomName: string }>(
        '/broadcast/token',
        { method: 'POST' },
      );
      if (!res.data) return null;

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: { deviceId: selectedMicIdRef.current ?? undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      attachRoomHandlers(room, '__broadcast__', 'All Call');
      room.on(RoomEvent.Disconnected, () => {
        if (broadcastRoomRef.current === room) {
          broadcastRoomRef.current = null;
          if (broadcastTransmitRef.current) setIsConnected(false);
        }
      });

      broadcastRoomRef.current = room;
      await room.connect(normalizeLivekitUrl(res.data.livekitUrl), res.data.token);
      room.startAudio().catch(() => {});
      return room;
    } catch (err) {
      console.warn('[VoiceContext] Failed to join All Call room:', err);
      broadcastRoomRef.current = null;
      return null;
    }
  }, [attachRoomHandlers, normalizeLivekitUrl]);

  // â”€â”€ joinMonitorRoom â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Connects to a group's LiveKit room in receive-only mode (mic disabled).
  // Idempotent: returns the existing room if already monitoring.
  const joinMonitorRoom = useCallback(async (groupId: string, groupName: string): Promise<Room | null> => {
    const existing = monitorRoomsRef.current.get(groupId);
    if (existing) return existing;

    groupNamesRef.current.set(groupId, groupName);

    try {
      const res = await apiFetch<{ token: string; livekitUrl: string; roomName: string }>(
        `/groups/${groupId}/token`,
        { method: 'POST' },
      );
      if (!res.data) return null;

      const { token, livekitUrl: rawUrl } = res.data;
      const livekitUrl = normalizeLivekitUrl(rawUrl);

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: { deviceId: selectedMicIdRef.current ?? undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      // â”€â”€ Floor messages from any monitored room â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const msg = JSON.parse(decoder.decode(payload)) as FloorMessage;
          if (msg.type === 'floor:granted') {
            const gName = groupNamesRef.current.get(groupId) ?? null;
            const f: FloorState = { held: true, holderId: msg.userId, holderName: msg.userName, groupId, groupName: gName };
            floorRef.current = f;
            setFloor(f);
            // Recording is now started server-side as part of the speaker's
            // own /api/voice/floor/request call. Dispatch no longer needs
            // to fire its own /clips/start — that would create duplicates.
          } else if (msg.type === 'floor:released') {
            setFloor(prev => {
              if (prev.groupId !== groupId) return prev;
              floorRef.current = CLEARED_FLOOR;
              return CLEARED_FLOOR;
            });
            // Stop is also server-side (releaseFloor calls stopClipEgress).
          }
        } catch { /* ignore malformed */ }
      });

      // â”€â”€ Incoming audio from any monitored room â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      room.on(RoomEvent.TrackSubscribed, (track, pub: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLMediaElement;
          el.id = `audio-${pub.trackSid}`;
          el.autoplay = true;
          el.muted = groupAudioMutedRef.current;
          (el as any).playsInline = true;
          document.body.appendChild(el);
          el.play().catch(() => {
            // Autoplay blocked â€” resume on next user interaction
            const resume = () => { el.play().catch(() => {}); };
            document.addEventListener('click', resume, { once: true });
            document.addEventListener('keydown', resume, { once: true });
          });
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach((el) => el.remove());
        }
      });

      // â”€â”€ Release floor if holder disconnects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        setFloor(prev => {
          if (prev.holderId === participant.identity && prev.groupId === groupId) {
            floorRef.current = CLEARED_FLOOR;
            return CLEARED_FLOOR;
          }
          return prev;
        });
      });

      // â”€â”€ Room disconnect: remove from map, clear active if needed â”€â”€â”€â”€â”€â”€â”€â”€
      room.on(RoomEvent.Disconnected, () => {
        monitorRoomsRef.current.delete(groupId);
        setMonitoredGroupIds((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
        if (activeRoomRef.current === room) {
          activeRoomRef.current = null;
          setIsConnected(false);
          if (countCleanupRef.current) { countCleanupRef.current(); countCleanupRef.current = null; }
        }
        setFloor(prev => {
          if (prev.groupId === groupId) { floorRef.current = CLEARED_FLOOR; return CLEARED_FLOOR; }
          return prev;
        });
      });

      monitorRoomsRef.current.set(groupId, room);
      await room.connect(livekitUrl, token);
      setMonitoredGroupIds((prev) => new Set(prev).add(groupId));
      // Receive-only: microphone stays disabled.
      // Resume AudioContext â€” safe because joinMonitorRoom is only called after a user gesture.
      room.startAudio().catch(() => {});
      return room;
    } catch (err) {
      console.warn(`[VoiceContext] Failed to monitor group ${groupId}:`, err);
      monitorRoomsRef.current.delete(groupId);
      return null;
    }
  }, []); // stable: only touches refs and setFloor (stable)

  const monitorGroups = useCallback(async (groups: GroupListItem[]) => {
    await Promise.all(groups.map((group) => joinMonitorRoom(group.id, group.name)));
  }, [joinMonitorRoom]);

  const stopMonitoringGroups = useCallback((groupIds: string[]) => {
    const ids = new Set(groupIds);
    for (const groupId of ids) {
      if (transmitChannelIdsRef.current.includes(groupId)) continue;
      const room = monitorRoomsRef.current.get(groupId);
      room?.disconnect();
      monitorRoomsRef.current.delete(groupId);
    }
    setMonitoredGroupIds((prev) => {
      const next = new Set(prev);
      for (const groupId of ids) next.delete(groupId);
      return next;
    });
  }, []);

  // Cleanup voice state when the dispatcher logs out.
  useEffect(() => {
    if (user) return;
    for (const room of monitorRoomsRef.current.values()) room.disconnect();
    monitorRoomsRef.current.clear();
    groupNamesRef.current.clear();
    if (countCleanupRef.current) { countCleanupRef.current(); countCleanupRef.current = null; }
      activeRoomRef.current = null;
      broadcastRoomRef.current?.disconnect();
      broadcastRoomRef.current = null;
      currentChannelIdRef.current = null;
      transmitChannelIdsRef.current = [];
      broadcastTransmitRef.current = false;
      setCurrentChannelId(null);
      setTransmitChannelIds([]);
      setIsBroadcastTransmit(false);
    setMonitoredGroupIds(new Set());
    setIsConnected(false);
    setIsConnecting(false);
    floorRef.current = CLEARED_FLOOR;
    setFloor(CLEARED_FLOOR);
    setIsPttActive(false);
    isPttActiveRef.current = false;
    setParticipantCount(0);
  }, [user]);

  // â”€â”€ joinChannel: set the active transmit group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const setTransmitChannels = useCallback(async (channelGroups: GroupListItem[]) => {
    const uniqueGroups = Array.from(new Map(channelGroups.map((group) => [group.id, group])).values());
    const primary = uniqueGroups[0] ?? null;

    setCurrentChannelId(primary?.id ?? null);
    currentChannelIdRef.current = primary?.id ?? null;
    setTransmitChannelIds(uniqueGroups.map((group) => group.id));
    transmitChannelIdsRef.current = uniqueGroups.map((group) => group.id);
    setLastError(null);
    setIsConnecting(uniqueGroups.length > 0);

    try {
      const rooms = await Promise.all(uniqueGroups.map((group) => joinMonitorRoom(group.id, group.name)));
      const connectedRooms = rooms.filter((room): room is Room => Boolean(room));
      if (uniqueGroups.length > 0 && connectedRooms.length === 0) throw new Error('Failed to connect to group voice');

      // Clean up previous active-room participant-count listeners
      if (countCleanupRef.current) { countCleanupRef.current(); countCleanupRef.current = null; }

      activeRoomRef.current = connectedRooms[0] ?? null;
      setIsConnected(connectedRooms.some((room) => room.state === 'connected'));

      // Track participant count for the active room
      const updateCount = () => {
        setParticipantCount(
          connectedRooms.reduce((total, room) => total + room.remoteParticipants.size + 1, 0),
        );
      };
      for (const room of connectedRooms) {
        room.on(RoomEvent.ParticipantConnected, updateCount);
        room.on(RoomEvent.ParticipantDisconnected, updateCount);
      }
      updateCount();
      countCleanupRef.current = () => {
        for (const room of connectedRooms) {
          room.off(RoomEvent.ParticipantConnected, updateCount);
          room.off(RoomEvent.ParticipantDisconnected, updateCount);
        }
      };

      // Pre-warm mic for lower PTT latency
      if (canCaptureAudio && connectedRooms.length > 0) {
        try {
          for (const room of connectedRooms) {
            await room.localParticipant.setMicrophoneEnabled(true);
            await room.localParticipant.setMicrophoneEnabled(false);
          }
        } catch { /* not critical */ }
      } else if (!canCaptureAudio) {
        setLastError('Microphone unavailable. Open Dispatch over HTTPS and allow microphone access.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join voice';
      setLastError(message);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [joinMonitorRoom, canCaptureAudio]);

  const joinChannel = useCallback(async (channelId: string) => {
    const groupName = groupNamesRef.current.get(channelId) || '';
    await setTransmitChannels([{ id: channelId, name: groupName }]);
  }, [setTransmitChannels]);

  const setBroadcastTransmit = useCallback(async (enabled: boolean) => {
    broadcastTransmitRef.current = enabled;
    setIsBroadcastTransmit(enabled);

    if (!enabled) {
      setIsConnected(activeRoomRef.current?.state === 'connected');
      return;
    }

    setLastError(null);
    setIsConnecting(true);
    try {
      const room = await joinBroadcastRoom();
      if (!room) throw new Error('Failed to connect to All Call');
      setIsConnected(room.state === 'connected');

      if (canCaptureAudio) {
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          await room.localParticipant.setMicrophoneEnabled(false);
        } catch { /* not critical */ }
      } else {
        setLastError('Microphone unavailable. Open Dispatch over HTTPS and allow microphone access.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join All Call';
      setLastError(message);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [canCaptureAudio, joinBroadcastRoom]);

  // ── leaveChannel: clear transmit target (keep monitoring all rooms) ────
  const leaveChannel = useCallback(() => {
    const room = activeRoomRef.current;
    if (room && isPttActiveRef.current) {
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      // Best-effort floor release. The server's participant_disconnected
      // webhook will force-release anyway on actual disconnect, but issuing
      // an explicit release keeps the floor free for other speakers
      // sooner if we're staying connected to the room.
      const requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-leave`;
      apiFetch('/voice/floor/release', {
        method: 'POST',
        body: JSON.stringify({ requestId, roomName: room.name }),
      }).catch(() => { /* best-effort */ });
    }
    if (countCleanupRef.current) { countCleanupRef.current(); countCleanupRef.current = null; }
    activeRoomRef.current = null;
    currentChannelIdRef.current = null;
    transmitChannelIdsRef.current = [];
    broadcastTransmitRef.current = false;
    setCurrentChannelId(null);
    setTransmitChannelIds([]);
    setIsBroadcastTransmit(false);
    setIsConnected(false);
    setIsConnecting(false);
    setIsPttActive(false);
    isPttActiveRef.current = false;
    setParticipantCount(0);
    setLastError(null);
  }, []);

  // ── requestFloor: server-authoritative floor + recording (Phase 3B) ──
  // Strict ordering: keep mic muted, post /voice/floor/request, await ack,
  // play courtesy beep on capture: 'started', THEN unmute. Without this
  // the first syllable is lost while egress is still spinning up.
  const requestFloor = useCallback(() => {
    const rooms = broadcastTransmitRef.current
      ? [broadcastRoomRef.current].filter((room): room is Room => room != null && room.state === 'connected')
      : transmitChannelIdsRef.current
        .map((groupId) => monitorRoomsRef.current.get(groupId))
        .filter((room): room is Room => room != null && room.state === 'connected');
    const room = rooms[0] ?? null;
    if (!room || !user) return;
    if (!canCaptureAudio) {
      setLastError('Microphone unavailable. Open Dispatch over HTTPS and allow microphone access.');
      return;
    }
    if (floorRef.current.held && floorRef.current.holderId !== user.id) return;

    const userName = `${user.firstName} ${user.lastName}`;
    const channelId = broadcastTransmitRef.current ? '__broadcast__' : currentChannelIdRef.current;
    const gName = broadcastTransmitRef.current ? 'All Call' : channelId ? (groupNamesRef.current.get(channelId) ?? null) : null;
    const requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    lastFloorRequestIdRef.current = requestId;

    const isBroadcast = broadcastTransmitRef.current;
    // For multi-group dispatch, gName above is the FIRST group's name only;
    // when more than one group is selected, label them as a composite so the
    // recording timeline at least hints at the wider scope. (Per-room
    // fan-out so each group gets its own recording is a separate follow-up.)
    const targetLabel = isBroadcast
      ? 'All Call'
      : (transmitChannelIdsRef.current.length > 1
        ? transmitChannelIdsRef.current
            .map((id) => groupNamesRef.current.get(id) ?? id)
            .join(' + ')
        : gName);
    const requestBody: Record<string, unknown> = {
      requestId,
      roomName: room.name,
      identity: room.localParticipant.identity,
      targetType: isBroadcast ? 'all_call' : 'group',
      targetLabel,
    };
    if (!isBroadcast && channelId) requestBody.channelId = channelId;

    // Mark UI as "requesting" — don't unmute yet.
    setIsPttActive(true);
    isPttActiveRef.current = true;

    apiFetch<{ floor: 'granted' | 'denied'; capture: 'started' | 'skipped' | 'failed'; clipId?: string; reason?: string }>(
      '/voice/floor/request',
      { method: 'POST', body: JSON.stringify(requestBody) },
    )
      .then((res) => {
        const data = res.data;
        if (!data || data.floor !== 'granted') {
          setIsPttActive(false);
          isPttActiveRef.current = false;
          setLastError(data?.reason ?? 'Floor denied');
          return;
        }
        // Server granted floor + started egress. Beep now; unmute after a short
        // lead-in so egress is actually capturing before audio flows (no clipped
        // first syllable). The beep cues the user to talk after the tone.
        const unmute = () => {
          if (!isPttActiveRef.current) return; // released during the lead-in
          for (const targetRoom of rooms) {
            targetRoom.localParticipant.setMicrophoneEnabled(true).catch((err: Error) => {
              setLastError(err.message || 'Failed to enable microphone');
            });
          }
        };
        if (data.capture === 'started') {
          playGrantBeep();
          setTimeout(unmute, LEAD_IN_MS);
        } else {
          unmute(); // nothing being recorded → no need to wait
        }
        const f: FloorState = { held: true, holderId: user.id, holderName: userName, groupId: channelId, groupName: gName };
        floorRef.current = f;
        setFloor(f);
        if (data.capture !== 'started') {
          setLastError(`Recording skipped — ${data.capture}`);
        }
      })
      .catch((err) => {
        setIsPttActive(false);
        isPttActiveRef.current = false;
        setLastError(err instanceof Error ? err.message : 'Floor request failed');
      });
  }, [user, canCaptureAudio, playGrantBeep]);

  // ── releaseFloor: mute first, then post /voice/floor/release ──────
  const releaseFloor = useCallback(() => {
    const room = activeRoomRef.current;
    const rooms = broadcastTransmitRef.current
      ? [broadcastRoomRef.current].filter((targetRoom): targetRoom is Room => targetRoom != null && targetRoom.state === 'connected')
      : transmitChannelIdsRef.current
        .map((groupId) => monitorRoomsRef.current.get(groupId))
        .filter((targetRoom): targetRoom is Room => targetRoom != null && targetRoom.state === 'connected');
    if ((!room && rooms.length === 0) || !isPttActiveRef.current || !user) return;

    // Mute first so trailing audio doesn't sneak through after egress stops.
    for (const targetRoom of rooms) {
      targetRoom.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    }
    floorRef.current = CLEARED_FLOOR;
    setFloor(CLEARED_FLOOR);
    setIsPttActive(false);
    isPttActiveRef.current = false;

    const targetRoom = rooms[0] ?? room;
    if (!targetRoom) return;
    const requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    apiFetch('/voice/floor/release', {
      method: 'POST',
      body: JSON.stringify({ requestId, roomName: targetRoom.name }),
    }).catch(() => { /* server-side lease checker will catch if this fails */ });
  }, [user]);

  // â”€â”€ Group audio mute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const setGroupAudioMuted = useCallback((muted: boolean) => {
    groupAudioMutedRef.current = muted;
    setGroupAudioMutedState(muted);
    document.querySelectorAll<HTMLMediaElement>('[id^="audio-"]').forEach((el) => {
      el.muted = muted;
    });
  }, []);

  // â”€â”€ Keyboard PTT (Space) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isInputFocused()) {
        e.preventDefault();
        requestFloor();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isInputFocused()) {
        e.preventDefault();
        releaseFloor();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [requestFloor, releaseFloor]);

  // â”€â”€ Cleanup on unmount â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    return () => {
      if (countCleanupRef.current) countCleanupRef.current();
      broadcastRoomRef.current?.disconnect();
      for (const room of monitorRoomsRef.current.values()) room.disconnect();
      monitorRoomsRef.current.clear();
    };
  }, []);

  return (
    <VoiceCtx.Provider
      value={{
        currentChannelId,
        transmitChannelIds,
        monitoredGroupIds,
        isConnected,
        isConnecting,
        lastError,
        joinChannel,
        setTransmitChannels,
        setBroadcastTransmit,
        leaveChannel,
        monitorGroups,
        stopMonitoringGroups,
        floor,
        requestFloor,
        releaseFloor,
        isPttActive,
        isBroadcastTransmit,
        participantCount,
        groupAudioMuted,
        setGroupAudioMuted,
        selectedMicId,
        setMicDevice,
        micLevel,
      }}
    >
      {children}
    </VoiceCtx.Provider>
  );
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceCtx);
  if (!ctx) throw new Error('useVoice must be used within VoiceProvider');
  return ctx;
}

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}
