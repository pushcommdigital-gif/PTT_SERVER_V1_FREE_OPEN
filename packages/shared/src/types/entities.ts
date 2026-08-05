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
import type {
  Role,
  CallPriority,
  CallState,
  CallSource,
  DispatchType,
  GroupType,
  MessageType,
  AudioCategory,
  CustomStateType,
} from '../constants.js';

export interface Department {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  departmentId: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserStateEntry {
  id: string;
  userId: string;
  state: string;
  customStateId: string | null;
  note: string | null;
  timestamp: string;
  changedBy: string | null;
}

export interface Group {
  id: string;
  departmentId: string;
  parentGroupId: string | null;
  name: string;
  type: GroupType;
  description: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  isAdmin: boolean;
  joinedAt: string;
}

export interface Unit {
  id: string;
  departmentId: string;
  stationGroupId: string | null;
  name: string;
  type: string | null;
  plateNumber: string | null;
  vin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Call {
  id: string;
  departmentId: string;
  number: number;
  name: string;
  nature: string | null;
  priority: CallPriority;
  type: string | null;
  state: CallState;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  source: CallSource | null;
  reportedBy: string | null;
  closedBy: string | null;
  closedAt: string | null;
  dispatchCount: number;
  lastDispatchedAt: string | null;
  formData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CallDispatch {
  id: string;
  callId: string;
  dispatchType: DispatchType;
  targetId: string;
  dispatchedBy: string | null;
  dispatchedAt: string;
  acknowledgedAt: string | null;
  onSceneAt: string | null;
  clearedAt: string | null;
}

export interface Location {
  id: string;
  userId: string | null;
  unitId: string | null;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: string;
}

export interface AudioLibraryItem {
  id: string;
  departmentId: string;
  filename: string;
  filePath: string;
  fileSize: number | null;
  duration: number | null;
  mimeType: string | null;
  category: AudioCategory;
  uploadedBy: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  departmentId: string;
  senderId: string;
  type: MessageType;
  targetUserId: string | null;
  targetGroupId: string | null;
  subject: string | null;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface CustomState {
  id: string;
  departmentId: string;
  type: CustomStateType;
  name: string;
  buttonText: string;
  buttonColor: string;
  displayOrder: number;
  createdAt: string;
}

export interface RoleEntity {
  id: string;
  departmentId: string;
  name: string;
  displayName: string;
  description: string | null;
  hierarchyLevel: number;
  color: string;
  isSystem: boolean;
  createdAt: string;
}

export interface GroupTypeEntity {
  id: string;
  departmentId: string;
  name: string;
  displayName: string;
  description: string | null;
  color: string;
  isSystem: boolean;
  createdAt: string;
}

export interface DeviceEntity {
  id: string;
  departmentId: string;
  imei: string;
  name: string;
  model: string | null;
  assignedUserId: string | null;
  assignedGroupId: string | null;
  provisioningKey: string;
  status: 'pending' | 'active' | 'disabled';
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceChannel {
  id: string;
  departmentId: string;
  name: string;
  livekitRoom: string;
  displayOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActionLog {
  id: string;
  departmentId: string;
  userId: string | null;
  targetType: string | null;
  targetId: string | null;
  action: string;
  details: Record<string, unknown>;
  timestamp: string;
}
