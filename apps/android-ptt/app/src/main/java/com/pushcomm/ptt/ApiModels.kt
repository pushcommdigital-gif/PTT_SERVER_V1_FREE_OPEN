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
package com.pushcomm.ptt

data class LoginPayload(
  val email: String,
  val password: String,
)

data class ProvisionPayload(
  val code: String,
)

data class RefreshPayload(
  val refreshToken: String,
)

data class RefreshData(
  val accessToken: String,
  val refreshToken: String,
)

data class LoginData(
  val accessToken: String,
  val refreshToken: String,
  val user: LoginUser?,
  // Only populated by POST /api/devices/provision (the QR/manual code flow);
  // null on regular email+password login. Carries the device-assignment hints
  // the app needs to skip first-run group selection.
  val device: ProvisionedDevice? = null,
)

data class LoginUser(
  val id: String,
  val firstName: String,
  val lastName: String,
  val role: String?,
  val username: String? = null,
)

data class ProvisionedDevice(
  val id: String?,
  val name: String?,
  val imei: String?,
  val assignedUserId: String?,
  val assignedGroupId: String?,
)

data class ApiEnvelope<T>(
  val success: Boolean,
  val data: T?,
  val error: String?,
)

// Lightweight envelope for responses where we only need success/error (no data field)
data class SimpleResponse(
  val success: Boolean,
  val error: String?,
)

data class GroupItem(
  val id: String,
  val name: String,
)


data class VoiceTokenData(
  val token: String,
  val livekitUrl: String,
  val roomName: String,
)

data class UserItem(
  val id: String,
  val firstName: String,
  val lastName: String,
  val username: String,
)

data class MessageData(
  val id: String,
  val senderId: String,
  val type: String,
  val targetUserId: String?,
  val targetGroupId: String?,
  val body: String,
  val createdAt: String,
  val senderFirstName: String?,
  val senderLastName: String?,
)

data class DirectConversation(
  val partner_id: String,
  val partner_first_name: String,
  val partner_last_name: String,
  val last_message: String,
  val last_message_at: String,
  val unread_count: Int,
)

data class GroupConversation(
  val group_id: String,
  val group_name: String,
  val last_message: String,
  val last_message_at: String,
  val unread_count: Int,
)

data class BroadcastConversation(
  val id: String,
  val subject: String?,
  val last_message: String,
  val last_message_at: String,
  val is_read: Boolean,
)

data class ConversationsData(
  val direct: List<DirectConversation>,
  val group: List<GroupConversation>,
  val broadcast: List<BroadcastConversation>,
)

// ── Location / Map ──────────────────────────────────────────────────────────

data class LocationPayload(
  val latitude: Double,
  val longitude: Double,
  val accuracy: Float? = null,
  val speed: Float? = null,
  val heading: Float? = null,
  val altitude: Double? = null,
)

/** A single fix in a store-and-forward batch — carries its own recorded timestamp (epoch ms). */
data class LocationFix(
  val latitude: Double,
  val longitude: Double,
  val accuracy: Float? = null,
  val speed: Float? = null,
  val heading: Float? = null,
  val altitude: Double? = null,
  val timestamp: Long,
)

data class LocationBatchPayload(val fixes: List<LocationFix>)

data class MapDriver(
  val id: String,
  val firstName: String,
  val lastName: String,
  val username: String,
  val groupId: String? = null,
  val groupName: String? = null,
  val latitude: Double?,
  val longitude: Double?,
  val lastLocationAt: String?,
  val status: String? = null,
  val statusLabel: String? = null,
  val statusColor: String? = null,
  val statusAt: String? = null,
)

data class MapOverviewData(
  val drivers: List<MapDriver>,
)

data class UserStatusPayload(
  val state: String,
  val note: String? = null,
)

data class UserStatusData(
  val id: String? = null,
  val state: String,
  val label: String? = null,
  val color: String? = null,
  val timestamp: String? = null,
)

// ── Audio Recording v2 — Phase 3 floor handshake ─────────────────────────────

data class FloorRequestPayload(
  val requestId: String,
  val roomName: String,
  val identity: String,
  val channelId: String?,
  val targetType: String?,
  val targetLabel: String?,
)

data class FloorReleasePayload(
  val requestId: String,
  val roomName: String,
)

data class FloorGrantData(
  val floor: String?,          // "granted" | "denied"
  val capture: String?,        // "started" | "skipped" | "failed"
  val clipId: String?,
  val egressId: String?,
  val reason: String?,
  val captureError: String?,
)

data class FloorReleaseData(
  val released: Boolean?,
  val reason: String?,
)
