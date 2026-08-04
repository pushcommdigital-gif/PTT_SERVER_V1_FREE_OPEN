// Real-time WebSocket events, scoped per department by the server
// (`broadcast(departmentId, event)`).
//
// EXTENSION POINT — this file defines the CORE events only. The union is open:
// `WsEventMap` is an interface, so a private add-on package extends it by
// declaration merging without the core ever referencing the add-on:
//
//   // addons/transcription/src/ws-events.ts
//   export interface WsTranscriptAlert { event: 'transcript:alert'; ... }
//   declare module '@pushcomm/shared' {
//     interface WsEventMap { 'transcript:alert': WsTranscriptAlert }
//   }
//
// `WsEvent` and `WsEventName` are derived from the map, so both widen
// automatically once an add-on is present. Nothing here needs to change.

export interface WsUserStatusChanged {
  event: 'user:status_changed';
  userId: string;
  state: string;
  changedBy: string | null;
  timestamp: string;
}

export interface WsCustomStateUpdated {
  event: 'custom_state:updated';
  type?: string;
  stateId?: string;
  timestamp: string;
}

export interface WsUserOnline {
  event: 'user:online';
  userId: string;
  timestamp: string;
}

export interface WsUserOffline {
  event: 'user:offline';
  userId: string;
  timestamp: string;
}

export interface WsUserPresence {
  event: 'user:presence';
  userId: string;
  online: boolean;
  timestamp: string;
}

export interface WsLocationUpdate {
  event: 'location:update';
  userId: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  timestamp: string;
}

export interface WsCallCreated {
  event: 'call:created';
  callId: string;
  name: string;
  priority: string;
  timestamp: string;
}

export interface WsCallDispatched {
  event: 'call:dispatched';
  callId: string;
  dispatchType: string;
  targetId: string;
  timestamp: string;
}

export interface WsCallClosed {
  event: 'call:closed';
  callId: string;
  closedBy: string;
  timestamp: string;
}

export interface WsFloorGranted {
  event: 'floor:granted';
  channelId: string;
  userId: string;
  timestamp: string;
}

export interface WsFloorReleased {
  event: 'floor:released';
  channelId: string;
  timestamp: string;
}

export interface WsFloorDenied {
  event: 'floor:denied';
  channelId: string;
  reason: string;
  timestamp: string;
}

// --- Call mutation events ---
export interface WsCallUpdated {
  event: 'call:updated';
  callId: string;
  timestamp: string;
}

export interface WsCallNoteAdded {
  event: 'call:note_added';
  callId: string;
  timestamp: string;
}

// --- Unit events ---
export interface WsUnitCreated {
  event: 'unit:created';
  unitId: string;
  timestamp: string;
}

export interface WsUnitUpdated {
  event: 'unit:updated';
  unitId: string;
  timestamp: string;
}

export interface WsUnitDeleted {
  event: 'unit:deleted';
  unitId: string;
  timestamp: string;
}

// --- User mutation events ---
export interface WsUserCreated {
  event: 'user:created';
  userId: string;
  timestamp: string;
}

export interface WsUserUpdated {
  event: 'user:updated';
  userId: string;
  timestamp: string;
}

export interface WsUserDeleted {
  event: 'user:deleted';
  userId: string;
  timestamp: string;
}

// --- Group events ---
export interface WsGroupCreated {
  event: 'group:created';
  groupId: string;
  timestamp: string;
}

export interface WsGroupUpdated {
  event: 'group:updated';
  groupId: string;
  timestamp: string;
}

export interface WsGroupDeleted {
  event: 'group:deleted';
  groupId: string;
  timestamp: string;
}

export interface WsGroupMemberAdded {
  event: 'group:member_added';
  groupId: string;
  userId: string;
  timestamp: string;
}

export interface WsGroupMemberRemoved {
  event: 'group:member_removed';
  groupId: string;
  userId: string;
  timestamp: string;
}

// --- Message events ---
export interface WsMessageCreated {
  event: 'message:created';
  messageId: string;
  senderId: string;
  type: string;
  targetUserId?: string | null;
  targetGroupId?: string | null;
  timestamp: string;
}

export interface WsMessageRead {
  event: 'message:read';
  messageId?: string;
  readBy: string;
  timestamp: string;
}

export interface WsPrivateCallIncoming {
  event: 'private_call:incoming';
  initiatorId: string;
  initiatorFirstName: string;
  initiatorLastName: string;
  targetUserId: string;
  roomName: string;
  timestamp: string;
}

export interface WsPrivateCallEnded {
  event: 'private_call:ended';
  endedBy: string;
  targetUserId: string;
  roomName: string;
  timestamp: string;
}

// --- Voice channel events ---
export interface WsVoiceChannelCreated {
  event: 'voice_channel:created';
  channelId: string;
  timestamp: string;
}

export interface WsVoiceChannelUpdated {
  event: 'voice_channel:updated';
  channelId: string;
  timestamp: string;
}

export interface WsVoiceChannelDeleted {
  event: 'voice_channel:deleted';
  channelId: string;
  timestamp: string;
}

// --- Device events ---
export interface WsDeviceCreated {
  event: 'device:created';
  deviceId: string;
  timestamp: string;
}

export interface WsDeviceUpdated {
  event: 'device:updated';
  deviceId: string;
  timestamp: string;
}

export interface WsDeviceDeleted {
  event: 'device:deleted';
  deviceId: string;
  timestamp: string;
}

// --- SOS / Lone Worker ---
export interface WsSosTriggered {
  event: 'sos:triggered';
  sosId: string;
  userId: string;
  firstName: string;
  lastName: string;
  latitude: number | null;
  longitude: number | null;
  timestamp: string;
}

export interface WsSosAcknowledged {
  event: 'sos:acknowledged';
  sosId: string;
  acknowledgedBy: string;
  timestamp: string;
}

export interface WsSosCancelled {
  event: 'sos:cancelled';
  sosId: string;
  cancelledBy: string;
  timestamp: string;
}

export interface WsSosResolved {
  event: 'sos:resolved';
  sosId: string;
  resolvedBy: string;
  disposition: string;
  timestamp: string;
}

// --- Zones: geofences & points of interest ---
export interface WsGeofenceAlert {
  event: 'geofence:alert';
  geofenceId: string;
  geofenceName: string;
  userId: string;
  firstName: string;
  lastName: string;
  type: 'enter' | 'exit';
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface WsGeofenceUpdated {
  event: 'geofence:updated';
  timestamp: string;
}

export interface WsPoiAlert {
  event: 'poi:alert';
  poiId: string;
  poiName: string;
  userId: string;
  firstName: string;
  lastName: string;
  type: 'enter' | 'exit';
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface WsPoiUpdated {
  event: 'poi:updated';
  timestamp: string;
}

/** A completed PTT clip is recorded and ready. */
export interface WsRecordingReady {
  event: 'recording:ready';
  recordingId: string;
  speakerLabel: string | null;
  targetLabel: string | null;
  channelName: string | null;
  durationSec: number | null;
  startedAt: string;
  isSos: boolean;
}

/**
 * The core event registry. Add-ons widen this by declaration merging — see the
 * note at the top of this file. Keys are the wire `event` names.
 */
export interface WsEventMap {
  'user:status_changed': WsUserStatusChanged;
  'custom_state:updated': WsCustomStateUpdated;
  'user:online': WsUserOnline;
  'user:offline': WsUserOffline;
  'user:presence': WsUserPresence;
  'location:update': WsLocationUpdate;
  'call:created': WsCallCreated;
  'call:dispatched': WsCallDispatched;
  'call:closed': WsCallClosed;
  'call:updated': WsCallUpdated;
  'call:note_added': WsCallNoteAdded;
  'unit:created': WsUnitCreated;
  'unit:updated': WsUnitUpdated;
  'unit:deleted': WsUnitDeleted;
  'user:created': WsUserCreated;
  'user:updated': WsUserUpdated;
  'user:deleted': WsUserDeleted;
  'group:created': WsGroupCreated;
  'group:updated': WsGroupUpdated;
  'group:deleted': WsGroupDeleted;
  'group:member_added': WsGroupMemberAdded;
  'group:member_removed': WsGroupMemberRemoved;
  'floor:granted': WsFloorGranted;
  'floor:released': WsFloorReleased;
  'floor:denied': WsFloorDenied;
  'message:created': WsMessageCreated;
  'message:read': WsMessageRead;
  'private_call:incoming': WsPrivateCallIncoming;
  'private_call:ended': WsPrivateCallEnded;
  'voice_channel:created': WsVoiceChannelCreated;
  'voice_channel:updated': WsVoiceChannelUpdated;
  'voice_channel:deleted': WsVoiceChannelDeleted;
  'device:created': WsDeviceCreated;
  'device:updated': WsDeviceUpdated;
  'device:deleted': WsDeviceDeleted;
  'sos:triggered': WsSosTriggered;
  'sos:acknowledged': WsSosAcknowledged;
  'sos:cancelled': WsSosCancelled;
  'sos:resolved': WsSosResolved;
  'geofence:alert': WsGeofenceAlert;
  'geofence:updated': WsGeofenceUpdated;
  'poi:alert': WsPoiAlert;
  'poi:updated': WsPoiUpdated;
  'recording:ready': WsRecordingReady;
}

export type WsEvent = WsEventMap[keyof WsEventMap];

export type WsEventName = keyof WsEventMap;
