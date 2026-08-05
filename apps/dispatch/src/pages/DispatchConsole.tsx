import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConversations } from '../hooks/useMessages';
import { useMessageNotifications } from '../hooks/useMessageNotifications';

import { HeaderBar } from '../components/layout/HeaderBar';
import { TopTabsBar } from '../components/layout/TopTabsBar';
import { BottomStatusBar } from '../components/layout/BottomStatusBar';
import { MapPanel } from '../components/layout/MapPanel';
import { FloatingPanel } from '../components/layout/FloatingPanel';
import { SidebarPanel } from '../components/sidebar/SidebarPanel';
import { AudioRecordingsPanel } from '../components/tabs/AudioRecordingsPanel';
import { SosLogPanel } from '../components/tabs/SosLogPanel';
import { ZoneAlertsPanel } from '../components/tabs/ZoneAlertsPanel';
import { TrackReplayPanel } from '../components/tabs/TrackReplayPanel';
import { GeoFencePanel } from '../components/tabs/GeoFencePanel';
import { UserStatusPanel } from '../components/tabs/UserStatusPanel';
import { MessagesPanel } from '../components/messages/MessagesPanel';
import { IncomingMessagesPanel } from '../components/messages/IncomingMessagesPanel';
import { MessageThread } from '../components/messages/MessageThread';
import type { ConversationItemData } from '../components/messages/ConversationItem';
import { PttWidget } from '../components/voice/PttWidget';
import { usePrivateCall } from '../hooks/usePrivateCall';
import { useTrackedUsers } from '../hooks/useTrackedUsers';
import { useGroups } from '../hooks/useGroups';
import { LayoutProvider, useLayout } from '../contexts/LayoutContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useVoice } from '../contexts/VoiceContext';
import { SosBanner } from '../components/SosBanner';
import { AlertToasts } from '../components/AlertToasts';
import { useWsEvent } from '../contexts/WebSocketContext';
import { apiFetch } from '../lib/api';
import type { GeoFence, PointOfInterest } from '../contexts/LayoutContext';
import { getRegisteredPanels } from '../addons/registry';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TalkTarget = { id: string; name: string };

/* ------------------------------------------------------------------ */
/*  Helper: panel wrapper that reads from LayoutContext                */
/* ------------------------------------------------------------------ */

interface LayoutPanelProps {
  panelId: string;
  title: string;
  children: React.ReactNode;
  minW?: number;
  minH?: number;
  maximizable?: boolean;
  resizable?: boolean;
  titleBarExtra?: React.ReactNode;
}

function LayoutPanel({ panelId, title, children, minW, minH, maximizable, resizable, titleBarExtra }: LayoutPanelProps) {
  const layout = useLayout();
  const panel = layout.panels[panelId];
  if (!panel?.visible) return null;

  return (
    <FloatingPanel
      id={`${panelId}-panel`}
      title={title}
      defaultX={panel.x}
      defaultY={panel.y}
      defaultW={panel.w}
      defaultH={panel.h}
      controlledX={panel.x}
      controlledY={panel.y}
      controlledW={panel.w}
      controlledH={panel.h}
      zIndex={panel.zIndex}
      minW={minW}
      minH={minH}
      maximizable={maximizable}
      resizable={resizable}
      titleBarExtra={titleBarExtra}
      onClose={() => layout.hidePanel(panelId)}
      onFocus={() => layout.bringToFront(panelId)}
      onGeometryChange={(x, y, w, h) =>
        layout.updatePanel(panelId, { x, y, w, h })
      }
    >
      {children}
    </FloatingPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Inner content (needs LayoutContext)                                 */
/* ------------------------------------------------------------------ */

function DispatchContent() {
  const layout = useLayout();
  const { user } = useAuth();
  const { conversations } = useConversations();
  const messageUnread = useMessageNotifications(user?.id, conversations);
  const privateCall = usePrivateCall();
  const { trackedIds, toggle: toggleTrack, addMany: trackUsers, removeMany: untrackUsers } = useTrackedUsers();
  const { monitorGroups, monitoredGroupIds, floor } = useVoice();
  const { monitorDefault, transmitDefault, followTalker } = useSettings();
  const { groups: allGroups, loading: groupsLoading } = useGroups({ page: 1, limit: 200, search: '', type: '' });

  // Expand / shrink PTT panel to fit private call row
  useEffect(() => {
    layout.updatePanel('ptt', { h: privateCall.state.isActive ? 235 : 175 });
  }, [privateCall.state.isActive, layout.updatePanel]);

  // Talk target selection state
  const [talkUsers, setTalkUsers] = useState<TalkTarget[]>([]);
  const [talkGroups, setTalkGroups] = useState<TalkTarget[]>([]);
  const [broadcast, setBroadcast] = useState(false);
  const [txDefaultsApplied, setTxDefaultsApplied] = useState(false);
  const [monitorDefaultsApplied, setMonitorDefaultsApplied] = useState(false);
  const [messageTarget, setMessageTarget] = useState<ConversationItemData | null>(null);
  const [quickReplyTarget, setQuickReplyTarget] = useState<ConversationItemData | null>(null);
  const [zoneLayersVisible, setZoneLayersVisible] = useState(false);
  const [sosUserIds, setSosUserIds] = useState<Set<string>>(new Set());
  const [sosFocus, setSosFocus] = useState<{ lat: number; lon: number; key: string } | null>(null);
  const sosUserBySosIdRef = useRef<Map<string, string>>(new Map());
  // "Follow the talker" — the unit currently on the air (the PTT floor holder).
  const speakingUnit = useMemo<{ id?: string; username?: string } | null>(() => {
    if (floor.held && floor.holderId && floor.holderId !== user?.id) return { id: floor.holderId };
    return null;
  }, [floor.held, floor.holderId, user?.id]);
  const restoreAfterPrivateCallRef = useRef<{
    users: TalkTarget[];
    groups: TalkTarget[];
    broadcast: boolean;
  } | null>(null);
  const privateCallRestoreArmedRef = useRef(false);
  const previousPrivateCallActiveRef = useRef(false);
  const previousUnreadRef = useRef(0);

  const loadOperationalZones = useCallback(async () => {
    try {
      const [fences, pois] = await Promise.all([
        apiFetch<GeoFence[]>('/geofences'),
        apiFetch<PointOfInterest[]>('/pois'),
      ]);
      if (fences.data) layout.setGeofencesToDisplay(fences.data);
      if (pois.data) layout.setPoisToDisplay(pois.data);
    } catch {
      // Non-blocking map overlay refresh; the editor panel still reports save errors.
    }
  }, [layout.setGeofencesToDisplay, layout.setPoisToDisplay]);

  const toggleZoneLayers = useCallback(() => {
    setZoneLayersVisible((visible) => {
      const next = !visible;
      if (next) void loadOperationalZones();
      return next;
    });
  }, [loadOperationalZones]);

  useEffect(() => {
    if (layout.panels.geoFence?.visible) {
      setZoneLayersVisible(true);
      void loadOperationalZones();
    }
  }, [layout.panels.geoFence?.visible, loadOperationalZones]);

  useWsEvent('geofence:updated', () => {
    if (zoneLayersVisible || layout.panels.geoFence?.visible) void loadOperationalZones();
  });

  useWsEvent('poi:updated', () => {
    if (zoneLayersVisible || layout.panels.geoFence?.visible) void loadOperationalZones();
  });

  // ── SOS: focus the map + highlight the sender + open the SOS panel ──────────
  const clearSosUser = useCallback((sosId: string) => {
    sosUserBySosIdRef.current.delete(sosId);
    setSosUserIds(new Set(sosUserBySosIdRef.current.values()));
  }, []);

  // Seed currently-active SOS so senders are already red on load.
  useEffect(() => {
    apiFetch<Array<{ id: string; reportedById?: string }>>('/sos')
      .then((res) => {
        const m = sosUserBySosIdRef.current;
        (res.data ?? []).forEach((a) => { if (a.reportedById) m.set(a.id, a.reportedById); });
        setSosUserIds(new Set(m.values()));
      })
      .catch(() => {});
  }, []);

  useWsEvent('sos:triggered', (e: any) => {
    if (e.userId) {
      sosUserBySosIdRef.current.set(e.sosId, e.userId);
      setSosUserIds(new Set(sosUserBySosIdRef.current.values()));
    }
    if (e.latitude != null && e.longitude != null) {
      setSosFocus({ lat: Number(e.latitude), lon: Number(e.longitude), key: `${e.sosId}-${Date.now()}` });
    }
    // Open the SOS Alerts panel at the right edge.
    layout.updatePanel('alarmRules', { x: Math.max(340, window.innerWidth - 340), y: 60 });
    layout.showPanel('alarmRules');
    layout.bringToFront('alarmRules');
  });
  useWsEvent('sos:acknowledged', (e: any) => clearSosUser(e.sosId));
  useWsEvent('sos:cancelled', (e: any) => clearSosUser(e.sosId));

  const selectedUserIds = useMemo(() => new Set(talkUsers.map((u) => u.id)), [talkUsers]);
  const selectedGroupIds = useMemo(() => new Set(talkGroups.map((g) => g.id)), [talkGroups]);

  useEffect(() => {
    if (privateCall.state.isActive) {
      if (!previousPrivateCallActiveRef.current && !restoreAfterPrivateCallRef.current) {
        const snapshot = {
          users: talkUsers,
          groups: talkGroups,
          broadcast,
        };
        restoreAfterPrivateCallRef.current = snapshot;
      }
      privateCallRestoreArmedRef.current = true;
      previousPrivateCallActiveRef.current = true;
      return;
    }
    if (!privateCallRestoreArmedRef.current || !previousPrivateCallActiveRef.current) return;

    const restore = restoreAfterPrivateCallRef.current;
    if (!restore) {
      privateCallRestoreArmedRef.current = false;
      previousPrivateCallActiveRef.current = false;
      return;
    }

    const restoredGroups =
      restore.broadcast && restore.groups.length === 0
        ? allGroups.map((group) => ({ id: group.id, name: group.name }))
        : restore.groups;

    setTalkUsers(restore.users);
    setTalkGroups(restoredGroups);
    setBroadcast(restore.broadcast);
    if (restoredGroups.length > 0) {
      void monitorGroups(restoredGroups);
    }
    restoreAfterPrivateCallRef.current = null;
    privateCallRestoreArmedRef.current = false;
    previousPrivateCallActiveRef.current = false;
  }, [allGroups, monitorGroups, privateCall.state.isActive, talkGroups, talkUsers]);

  const startPrivateCallWithRestore = useCallback((unitId: string, name: string) => {
    const snapshot = {
      users: talkUsers,
      groups: talkGroups,
      broadcast,
    };
    restoreAfterPrivateCallRef.current = snapshot;
    setBroadcast(false);
    setTalkUsers([{ id: unitId, name }]);
    setTalkGroups([]);
    privateCall.startCall(unitId, name);
    layout.showPanel('ptt');
    layout.bringToFront('ptt');
  }, [broadcast, layout, privateCall, talkGroups, talkUsers]);

  const toggleTalkUser = useCallback((user: TalkTarget) => {
    setTalkUsers((prev) =>
      prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user],
    );
  }, []);

  const toggleTalkGroup = useCallback((group: TalkTarget) => {
    setBroadcast(false);
    setTalkGroups((prev) =>
      prev.some((g) => g.id === group.id) ? prev.filter((g) => g.id !== group.id) : [...prev, group],
    );
  }, []);

  const toggleBroadcast = useCallback(() => {
    setBroadcast((active) => {
      const next = !active;
      if (next) {
        setTalkGroups(allGroups.map((group) => ({ id: group.id, name: group.name })));
      }
      return next;
    });
  }, [allGroups]);

  const selectAllTalkGroups = useCallback((groups: TalkTarget[]) => {
    setBroadcast(true);
    setTalkGroups(groups);
    // A dispatcher cannot transmit into a group room without joining it first.
    // Keeping TX-all and monitor-all in sync also prevents the PTT widget from
    // showing selected TX groups while the listener count remains at zero.
    void monitorGroups(groups);
  }, [monitorGroups]);

  const clearTalkGroups = useCallback(() => {
    setBroadcast(false);
    setTalkGroups([]);
  }, []);

  const clearSelection = useCallback(() => {
    setTalkUsers([]);
    setTalkGroups([]);
    setBroadcast(false);
  }, []);

  const openMessageTarget = useCallback((target: ConversationItemData) => {
    const width = Math.min(980, Math.max(760, window.innerWidth - 520));
    const height = Math.min(640, Math.max(480, window.innerHeight - 220));
    const x = Math.max(340, Math.floor((window.innerWidth - width) / 2));
    const y = Math.max(54, Math.floor((window.innerHeight - height) / 2));

    setMessageTarget(target);
    layout.updatePanel('message', { x, y, w: width, h: height });
    layout.showPanel('message');
    layout.bringToFront('message');
  }, [layout]);

  const openQuickReplyTarget = useCallback((target: ConversationItemData) => {
    const workspaceWidth = window.innerWidth;
    const workspaceHeight = Math.max(420, window.innerHeight - 40 - 44 - 32);
    const width = Math.min(560, Math.max(420, workspaceWidth - 80));
    const height = Math.min(620, Math.max(440, workspaceHeight - 32));
    const x = Math.min(Math.max(24, workspaceWidth - width - 28), Math.max(0, workspaceWidth - width));
    const y = Math.min(Math.max(24, workspaceHeight - height - 28), Math.max(0, workspaceHeight - height));

    setQuickReplyTarget(target);
    layout.updatePanel('quickReply', { x, y, w: width, h: height });
    layout.showPanel('quickReply');
    layout.bringToFront('quickReply');
  }, [layout]);

  useEffect(() => {
    if (messageUnread > previousUnreadRef.current) {
      layout.showPanel('incomingMessages');
      layout.bringToFront('incomingMessages');
    }
    previousUnreadRef.current = messageUnread;
  }, [layout, messageUnread]);

  const handleMapCallUnit = useCallback((unitId: string, name: string) => {
    startPrivateCallWithRestore(unitId, name);
  }, [startPrivateCallWithRestore]);

  const handleMapMessageUnit = useCallback((unitId: string, name: string) => {
    openMessageTarget({
      id: unitId,
      name,
      type: 'direct',
      lastMessage: 'Start conversation',
      lastMessageAt: new Date(0).toISOString(),
      unreadCount: 0,
    });
  }, [openMessageTarget]);

  const handleMapSelectGroupVoice = useCallback((groupId: string, name: string) => {
    const group = { id: groupId, name };
    setBroadcast(false);
    setTalkUsers([]);
    setTalkGroups([group]);
    void monitorGroups([group]);
    layout.showPanel('ptt');
    layout.bringToFront('ptt');
  }, [layout, monitorGroups]);

  const handleMapMessageGroup = useCallback((groupId: string, name: string) => {
    openMessageTarget({
      id: groupId,
      name,
      type: 'group',
      lastMessage: 'Start group conversation',
      lastMessageAt: new Date(0).toISOString(),
      unreadCount: 0,
    });
  }, [openMessageTarget]);

  useEffect(() => {
    if (groupsLoading || txDefaultsApplied || allGroups.length === 0) return;

    const storageKey = `pushcomm:dispatch:tx-groups:${user?.id ?? 'anonymous'}`;
    const byId = new Map(allGroups.map((group) => [group.id, { id: group.id, name: group.name }]));
    let nextGroups: TalkTarget[] = [];

    if (transmitDefault === 'all') {
      nextGroups = Array.from(byId.values());
      setBroadcast(true);
    } else if (transmitDefault === 'last') {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '[]') as string[];
        nextGroups = saved.map((id) => byId.get(id)).filter((group): group is TalkTarget => Boolean(group));
      } catch {
        nextGroups = [];
      }
    }

    setTalkGroups(nextGroups);
    setTxDefaultsApplied(true);
  }, [allGroups, groupsLoading, transmitDefault, txDefaultsApplied, user?.id]);

  useEffect(() => {
    if (!txDefaultsApplied) return;
    const storageKey = `pushcomm:dispatch:tx-groups:${user?.id ?? 'anonymous'}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(talkGroups.map((group) => group.id)));
    } catch {
      /* ignore */
    }
  }, [talkGroups, txDefaultsApplied, user?.id]);

  useEffect(() => {
    if (groupsLoading || monitorDefaultsApplied || allGroups.length === 0) return;

    const storageKey = `pushcomm:dispatch:monitor-groups:${user?.id ?? 'anonymous'}`;
    const byId = new Map(allGroups.map((group) => [group.id, { id: group.id, name: group.name }]));
    let groupsToMonitor = allGroups.map((group) => ({ id: group.id, name: group.name }));

    if (monitorDefault === 'last') {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '[]') as string[];
        const savedGroups = saved.map((id) => byId.get(id)).filter((group): group is TalkTarget => Boolean(group));
        groupsToMonitor = savedGroups.length > 0 ? savedGroups : groupsToMonitor;
      } catch {
        groupsToMonitor = allGroups.map((group) => ({ id: group.id, name: group.name }));
      }
    }

    void monitorGroups(groupsToMonitor);
    setMonitorDefaultsApplied(true);
  }, [allGroups, groupsLoading, monitorDefault, monitorDefaultsApplied, monitorGroups, user?.id]);

  useEffect(() => {
    if (!monitorDefaultsApplied) return;
    const storageKey = `pushcomm:dispatch:monitor-groups:${user?.id ?? 'anonymous'}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...monitoredGroupIds]));
    } catch {
      /* ignore */
    }
  }, [monitorDefaultsApplied, user?.id, monitoredGroupIds]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bg-primary">
      <SosBanner />
      <AlertToasts />
      <HeaderBar />
      <TopTabsBar
        messageBadge={messageUnread}
        zoneLayersVisible={zoneLayersVisible}
        onToggleZoneLayers={toggleZoneLayers}
      />

      {/* Main content area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Map as background (z-0) */}
        {layout.mapMode === 'background' && (
          <div className="absolute inset-0 z-0">
            <MapPanel
              isBackground
              onDetach={() => layout.setMapMode('floating')}
              trackedIds={trackedIds}
              onCallUnit={handleMapCallUnit}
              onMessageUnit={handleMapMessageUnit}
              onSelectGroupVoice={handleMapSelectGroupVoice}
              onMessageGroup={handleMapMessageGroup}
              showOperationalZones={zoneLayersVisible}
              sosUserIds={sosUserIds}
              sosFocus={sosFocus}
              speakingUnit={speakingUnit}
              followTalker={followTalker}
            />
          </div>
        )}

        {/* Map as floating panel */}
        {layout.mapMode === 'floating' && (
          <LayoutPanel panelId="map" title="Map" minW={520} minH={360}>
            <MapPanel
              isBackground={false}
              onDock={() => layout.setMapMode('background')}
              trackedIds={trackedIds}
              onCallUnit={handleMapCallUnit}
              onMessageUnit={handleMapMessageUnit}
              onSelectGroupVoice={handleMapSelectGroupVoice}
              onMessageGroup={handleMapMessageGroup}
              showOperationalZones={zoneLayersVisible}
              sosUserIds={sosUserIds}
              sosFocus={sosFocus}
              speakingUnit={speakingUnit}
              followTalker={followTalker}
            />
          </LayoutPanel>
        )}

        {/* Sidebar (Group/User tree) with selection */}
        <LayoutPanel panelId="sidebar" title="Group / Users" minW={280} minH={300}>
          <SidebarPanel
            broadcast={broadcast}
            onToggleBroadcast={toggleBroadcast}
            selectedGroupIds={selectedGroupIds}
            selectedGroups={talkGroups}
            selectedUserIds={selectedUserIds}
            selectedUsers={talkUsers}
            onToggleGroup={toggleTalkGroup}
            onSelectAllGroups={selectAllTalkGroups}
            onClearGroups={clearTalkGroups}
            onToggleUser={toggleTalkUser}
            onClearSelection={clearSelection}
            onCallUser={startPrivateCallWithRestore}
            activeCallUserId={privateCall.state.isActive ? privateCall.state.targetUserId : null}
            trackedIds={trackedIds}
            onToggleTrack={toggleTrack}
            onTrackUsers={trackUsers}
            onUntrackUsers={untrackUsers}
          />
        </LayoutPanel>

        {/* Voice Recordings */}
        <LayoutPanel panelId="voiceRec" title="Voice Recordings" minW={400} minH={300}>
          <AudioRecordingsPanel />
        </LayoutPanel>

        {/* Messages */}
        <LayoutPanel panelId="message" title="Messages" minW={720} minH={420}>
          <MessagesPanel initialConversation={messageTarget} />
        </LayoutPanel>

        {/* Personnel status overview */}
        <LayoutPanel panelId="status" title="Personnel Status" minW={320} minH={360}>
          <UserStatusPanel />
        </LayoutPanel>

        {/* Focused quick reply from incoming-message triage */}
        <LayoutPanel
          panelId="quickReply"
          title={quickReplyTarget ? `Quick Reply - ${quickReplyTarget.name}` : 'Quick Reply'}
          minW={380}
          minH={380}
        >
          {quickReplyTarget ? (
            <MessageThread conversation={quickReplyTarget} />
          ) : (
            <div className="h-full flex items-center justify-center p-4 text-center text-sm text-text-secondary/70">
              Select an incoming message to start a quick reply.
            </div>
          )}
        </LayoutPanel>

        {/* Incoming message triage */}
        <LayoutPanel
          panelId="incomingMessages"
          title="Incoming Messages"
          minW={320}
          minH={220}
          titleBarExtra={
            messageUnread > 0 ? (
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white animate-pulse">
                {messageUnread}
              </span>
            ) : null
          }
        >
          <IncomingMessagesPanel
            conversations={conversations}
            onOpenConversation={openQuickReplyTarget}
          />
        </LayoutPanel>

        {/* Geo-Fencing placeholder */}
        <LayoutPanel panelId="geoFence" title="Geo-Fencing" minW={300} minH={200}>
          <GeoFencePanel />
        </LayoutPanel>

        {/* SOS Alerts */}
        <LayoutPanel panelId="alarmRules" title="SOS Alerts" minW={280} minH={300}>
          <SosLogPanel
            onTalkToUnit={(userId, name) => startPrivateCallWithRestore(userId, name)}
            onRecenter={(lat, lon) => setSosFocus({ lat, lon, key: `recenter-${Date.now()}` })}
          />
        </LayoutPanel>

        {/* Zone Alerts — today's geofence/POI log */}
        <LayoutPanel panelId="zoneAlerts" title="Zone Alerts" minW={280} minH={300}>
          <ZoneAlertsPanel />
        </LayoutPanel>

        {/* Track Replay — historical GPS playback (raw fixes) */}
        <LayoutPanel panelId="trackReplay" title="Track Replay" minW={520} minH={380} resizable maximizable>
          <TrackReplayPanel />
        </LayoutPanel>

        {/* EXTENSION POINT: add-on panels from the registry. Empty in CE. */}
        {getRegisteredPanels().map((def) => {
          const Body = def.component;
          return (
            <LayoutPanel
              key={def.id}
              panelId={def.id}
              title={def.title}
              minW={def.minW}
              minH={def.minH}
              resizable={def.resizable}
              maximizable={def.maximizable}
            >
              <Body />
            </LayoutPanel>
          );
        })}

        {/* PTT Widget */}
        <LayoutPanel panelId="ptt" title="Push To Talk" minW={250} minH={70} maximizable={false}>
          <PttWidget
            variant="command"
            talkTargets={{ users: talkUsers, groups: talkGroups }}
            broadcast={broadcast}
            privateCall={{
              state: privateCall.state,
              onRequestFloor: privateCall.requestFloor,
              onReleaseFloor: privateCall.releaseFloor,
              onHangUp: privateCall.hangUp,
            }}
          />
        </LayoutPanel>
      </div>

      <BottomStatusBar />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Export: wraps in LayoutProvider                                     */
/* ------------------------------------------------------------------ */

export function DispatchConsole() {
  return (
    <SettingsProvider>
      <LayoutProvider>
        <DispatchContent />
      </LayoutProvider>
    </SettingsProvider>
  );
}
