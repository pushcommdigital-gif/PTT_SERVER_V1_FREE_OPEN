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

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.util.Log
import io.livekit.android.AudioOptions
import io.livekit.android.AudioType
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

// Lead-in: egress (the clip recorder) needs a moment to actually start capturing
// after LiveKit accepts the request, so we keep the mic muted briefly after the
// grant beep — otherwise the first syllable is lost from the recording (and the
// transcript). The beep is the "talk after the tone" cue. Tune against real clip
// starts; 200ms is a floor, 250-300ms may be needed.
private const val LEAD_IN_MS = 200L

/**
 * Android voice session manager (Audio Recording v2 — Phase 3B).
 * - Connects to LiveKit room from backend token endpoint and pre-publishes
 *   the mic in muted state so server-side egress finds an audio track the
 *   instant the floor is granted.
 * - On PTT press: requests floor from API; on grant beeps + unmutes mic.
 * - On PTT release: mutes mic, then releases floor server-side.
 * - The API broadcasts floor:granted/released into the room — we only listen
 *   for those messages here to update the displayed floor holder.
 */
class VoiceSessionManager(
    private val context: Context,
    private val onStateChanged: ((VoiceState) -> Unit)? = null,
    private val onDisconnected: (() -> Unit)? = null,
) {
    data class VoiceState(
        val connected: Boolean = false,
        val talking: Boolean = false,
        val roomName: String? = null,
        val floorHolderName: String? = null,
        val participantCount: Int = 0,
        val error: String? = null,
    )

    private var room: Room? = null
    private var broadcastRoom: Room? = null
    private var state = VoiceState()
    private var currentUserId: String? = null
    private var currentUserName: String? = null
    private var remoteAudioMuted = false

    private val eventScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var eventJob: Job? = null
    private var broadcastEventJob: Job? = null

    // ── Recording / floor handshake (Phase 3B-Android) ───────────────────────
    private val api = PushcommApi()
    private var recordingBaseUrl: String = ""
    private var recordingTokenProvider: (() -> String)? = null
    private var recordingChannelId: String = ""
    private var recordingChannelName: String = ""
    private var currentClipId: String? = null
    private var currentEgressId: String? = null
    private var lastFloorRequestId: String? = null
    private var beepTone: ToneGenerator? = null
    // Re-entry guard for startTalking. Some handset firmwares fire PTT.down +
    // PTT.long in rapid succession, and a stuck PTT button has been seen
    // to repeat the down broadcast continuously. Without this guard, every
    // repeat would queue another /voice/floor/request, beep, and burn an
    // egress slot.
    private var floorRequestInFlight = false
    // Set when stopTalking() runs while a grant is still pending. The grant
    // handler checks this and skips the unmute/beep/state-update — otherwise
    // the late grant would re-unmute the mic after the user already released
    // PTT, leaving the channel "stuck open" until they press PTT again.
    private var floorReleaseRequestedBeforeGrant = false

    /**
     * Call after connect() to enable server-side floor recording. The
     * [tokenProvider] is invoked fresh on each floor request so a stale
     * token snapshot can never cause a silent 401 (which was the original
     * bug that motivated Phase 3B).
     */
    fun setRecordingParams(
        baseUrl: String,
        tokenProvider: () -> String,
        channelId: String,
        channelName: String = "",
    ) {
        recordingBaseUrl = baseUrl
        recordingTokenProvider = tokenProvider
        recordingChannelId = channelId
        recordingChannelName = channelName
    }

    /**
     * Short courtesy beep — the audible "floor granted, talk now" cue.
     * Uses STREAM_MUSIC so the beep follows the device's main volume knob
     * (NOTIFICATION volume is often muted on rugged radios). Volume 100 of
     * 100 since this is a critical UX cue and most rugged-handset speakers
     * are relatively quiet.
     */
    private fun playGrantBeep() {
        try {
            val tone = beepTone ?: ToneGenerator(AudioManager.STREAM_MUSIC, 100).also { beepTone = it }
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, 150)
        } catch (e: Exception) {
            Log.w("VoiceSession", "beep failed: ${e.message}")
        }
    }

    private fun emit(next: VoiceState) {
        state = next
        onStateChanged?.invoke(next)
    }


    suspend fun connect(
        tokenData: VoiceTokenData,
        userId: String,
        userName: String,
        broadcastTokenData: VoiceTokenData? = null,
    ) = withContext(Dispatchers.Main) {
        disconnectInternal()
        currentUserId = userId
        currentUserName = userName

        try {
            val connectedRoom = createLiveKitRoom()
            connectedRoom.connect(tokenData.livekitUrl, tokenData.token)
            room = connectedRoom

            // Pre-create and immediately mute mic for low-latency PTT start.
            connectedRoom.localParticipant.setMicrophoneEnabled(enabled = true)
            connectedRoom.localParticipant.setMicrophoneEnabled(enabled = false)

            val initialCount = connectedRoom.remoteParticipants.size + 1
            emit(state.copy(connected = true, roomName = tokenData.roomName, participantCount = initialCount, error = null))

            startCollectingEvents(connectedRoom, isBroadcastRoom = false)

            // Every field device passively joins the department-wide All Call
            // room. Dispatch Broadcast All uses this room so the browser does
            // not need to publish one microphone track into many group rooms.
            if (broadcastTokenData != null) {
                connectBroadcastRoom(broadcastTokenData)
            }
        } catch (t: Throwable) {
            emit(
                VoiceState(
                    connected = false,
                    talking = false,
                    roomName = null,
                    participantCount = 0,
                    error = t.message ?: "Connect failed",
                ),
            )
            throw t
        }
    }

    private fun createLiveKitRoom(): Room = LiveKit.create(
        appContext = context.applicationContext,
        overrides = LiveKitOverrides(
            audioOptions = AudioOptions(
                // Use MediaAudioType (MODE_NORMAL) instead of the default
                // CallAudioType (MODE_IN_COMMUNICATION). The call mode routes
                // all system audio through the earpiece and affects every other
                // app on the phone. PTT is half-duplex so echo cancellation
                // from call mode is not needed.
                audioOutputType = AudioType.MediaAudioType(),
            ),
        ),
    )

    private suspend fun connectBroadcastRoom(tokenData: VoiceTokenData) {
        val allCallRoom = createLiveKitRoom()
        allCallRoom.connect(tokenData.livekitUrl, tokenData.token)
        broadcastRoom = allCallRoom
        startCollectingEvents(allCallRoom, isBroadcastRoom = true)
    }

    private fun startCollectingEvents(connectedRoom: Room, isBroadcastRoom: Boolean) {
        if (isBroadcastRoom) {
            broadcastEventJob?.cancel()
        } else {
            eventJob?.cancel()
        }
        val job = eventScope.launch {
            connectedRoom.events.collect { event ->
                when (event) {
                    is RoomEvent.Reconnecting -> {
                        // Network change (e.g. WiFi → cellular) causes LiveKit to attempt
                        // an internal reconnect, but the mic track and ICE candidates become
                        // stale. Treat this the same as a full disconnect so the service
                        // reconnects with a fresh token and a clean audio track.
                        if (!isBroadcastRoom && state.connected) {
                            emit(
                                VoiceState(
                                    connected = false,
                                    talking = false,
                                    roomName = null,
                                    floorHolderName = null,
                                    participantCount = 0,
                                    error = "Reconnecting...",
                                ),
                            )
                            onDisconnected?.invoke()
                        }
                    }
                    is RoomEvent.Disconnected -> {
                        // Only fire callback if this is an unexpected disconnect
                        // (not triggered by our own disconnect() call).
                        if (isBroadcastRoom) {
                            broadcastRoom = null
                        } else if (state.connected) {
                            emit(
                                VoiceState(
                                    connected = false,
                                    talking = false,
                                    roomName = null,
                                    floorHolderName = null,
                                    participantCount = 0,
                                    error = "Disconnected",
                                ),
                            )
                            onDisconnected?.invoke()
                        }
                    }
                    is RoomEvent.DataReceived -> {
                        handleDataReceived(event.data)
                    }
                    is RoomEvent.ParticipantConnected -> {
                        if (isBroadcastRoom) return@collect
                        val count = connectedRoom.remoteParticipants.size + 1
                        emit(state.copy(participantCount = count))
                        // Apply current mute state to newly joined participant
                        if (remoteAudioMuted) {
                            event.participant.trackPublications.values
                                .filter { it.kind == Track.Kind.AUDIO }
                                .forEach { pub -> pub.track?.enabled = false }
                        }
                    }
                    is RoomEvent.ParticipantDisconnected -> {
                        if (isBroadcastRoom) return@collect
                        val count = connectedRoom.remoteParticipants.size + 1
                        emit(state.copy(participantCount = count))
                    }
                    else -> Unit
                }
            }
        }
        if (isBroadcastRoom) {
            broadcastEventJob = job
        } else {
            eventJob = job
        }
    }

    private fun handleDataReceived(data: ByteArray) {
        try {
            val json = JSONObject(String(data))
            when (json.optString("type")) {
                "floor:granted" -> {
                    val senderName = json.optString("userName").takeIf { it.isNotBlank() } ?: "Unknown"
                    // Only update floor holder if it's someone else talking (not us)
                    if (!state.talking) {
                        emit(state.copy(floorHolderName = senderName))
                    }
                }
                "floor:released" -> {
                    if (!state.talking) {
                        emit(state.copy(floorHolderName = null))
                    }
                }
            }
        } catch (_: Exception) {
            // Ignore malformed data messages
        }
    }

    /**
     * Strict ordered handshake (Phase 3B-Android):
     *   1. Generate UUID requestId (idempotency key).
     *   2. POST /api/voice/floor/request — server resolves the speaker's
     *      audio track, starts egress, broadcasts floor:granted into the room.
     *   3. On floor=granted: play courtesy beep, then unmute mic.
     *   4. On denial: log + surface error, never unmute.
     *
     * The server is the sole authority for floor + recording, and the server
     * broadcasts floor:granted/released into the room so other participants
     * (dispatch, other field devices) see the holder change. We no longer
     * publishData() the floor message from the client.
     */
    suspend fun startTalking() = withContext(Dispatchers.Main) {
        val activeRoom = room ?: return@withContext
        if (!state.connected) return@withContext
        // Drop repeated PTT-down events from firmware/stuck-key conditions.
        if (floorRequestInFlight || state.talking) return@withContext
        floorRequestInFlight = true
        floorReleaseRequestedBeforeGrant = false
        // Clear any stale mic error from a previous failed attempt so the status
        // reflects THIS press (it re-sets below if the mic still won't publish).
        if (state.error != null) emit(state.copy(error = null))

        val roomName = state.roomName ?: return@withContext
        val speakerId = currentUserId ?: return@withContext
        val tokenProvider = recordingTokenProvider
        val baseUrl = recordingBaseUrl

        if (tokenProvider == null || baseUrl.isBlank()) {
            // Recording not configured — direct unmute (no floor handshake,
            // no recording). Should only happen in early-boot edge cases.
            activeRoom.localParticipant.setMicrophoneEnabled(enabled = true)
            emit(state.copy(talking = true, floorHolderName = currentUserName ?: "Me"))
            floorRequestInFlight = false
            return@withContext
        }

        val requestId = UUID.randomUUID().toString()
        lastFloorRequestId = requestId

        eventScope.launch {
            runCatching {
                api.requestFloor(
                    baseUrl = baseUrl,
                    accessToken = tokenProvider(),
                    payload = FloorRequestPayload(
                        requestId = requestId,
                        roomName = roomName,
                        identity = speakerId,
                        channelId = recordingChannelId.ifBlank { null },
                        targetType = "group",
                        targetLabel = recordingChannelName.ifBlank { null },
                    ),
                )
            }.onSuccess { result ->
                if (result.floor == "granted" && floorReleaseRequestedBeforeGrant) {
                    // RACE GUARD: user already released PTT while this grant
                    // was in flight. Don't unmute mic — that would leave the
                    // channel stuck open. Instead, immediately tell the
                    // server to release.
                    Log.d("VoiceSession", "late grant; user already released — sending release")
                    runCatching {
                        api.releaseFloor(
                            baseUrl = baseUrl,
                            accessToken = tokenProvider(),
                            payload = FloorReleasePayload(requestId = requestId, roomName = roomName),
                        )
                    }
                } else if (result.floor == "granted") {
                    currentClipId = result.clipId
                    currentEgressId = result.egressId
                    // Courtesy beep before unmute so the user hears the cue
                    // BEFORE their own voice goes live (avoids "speak first
                    // syllable then beep" awkwardness). Then a short lead-in so
                    // egress is actually capturing before the mic opens — no
                    // clipped first syllable in the recording/transcript.
                    if (result.capture == "started") {
                        playGrantBeep()
                        delay(LEAD_IN_MS)
                    }
                    if (floorReleaseRequestedBeforeGrant) {
                        // User released during the lead-in — abandon the unmute;
                        // stopTalking already muted + posted the release.
                        Log.d("VoiceSession", "released during lead-in — not unmuting")
                    } else {
                        // Unmute the mic and go live. (An earlier "verify the track then
                        // release the floor on a racy check" guard caused false failures —
                        // worst on the S23 — so PTT often didn't transmit. Reverted to the
                        // simple, reliable unmute.)
                        activeRoom.localParticipant.setMicrophoneEnabled(enabled = true)
                        emit(state.copy(talking = true, floorHolderName = currentUserName ?: "Me", error = null))
                    }
                } else {
                    Log.w("VoiceSession", "Floor denied: ${result.reason}")
                    emit(state.copy(error = result.reason ?: "Floor denied"))
                }
            }.onFailure { e ->
                Log.e("VoiceSession", "requestFloor failed", e)
                emit(state.copy(error = e.message ?: "Floor request failed"))
            }
            floorRequestInFlight = false
        }
    }

    suspend fun stopTalking() = withContext(Dispatchers.Main) {
        val activeRoom = room ?: return@withContext
        if (!state.connected) return@withContext

        // If a grant is still in flight, signal the grant handler to abandon
        // (re-release) instead of unmuting. Without this, the late grant
        // would re-unmute the mic after the user already released.
        if (floorRequestInFlight) {
            floorReleaseRequestedBeforeGrant = true
        }

        // Mute mic FIRST so no audio escapes after we tell the server we're done.
        activeRoom.localParticipant.setMicrophoneEnabled(enabled = false)
        emit(state.copy(talking = false, floorHolderName = null))

        val roomName = state.roomName ?: return@withContext
        val requestId = lastFloorRequestId ?: return@withContext
        val tokenProvider = recordingTokenProvider ?: return@withContext
        val baseUrl = recordingBaseUrl
        if (baseUrl.isBlank()) return@withContext

        currentClipId = null
        currentEgressId = null
        lastFloorRequestId = null

        eventScope.launch {
            runCatching {
                api.releaseFloor(
                    baseUrl = baseUrl,
                    accessToken = tokenProvider(),
                    payload = FloorReleasePayload(requestId = requestId, roomName = roomName),
                )
            }.onFailure { e ->
                Log.w("VoiceSession", "releaseFloor failed: ${e.message}")
            }
        }
    }

    /** Mute or unmute all incoming audio from remote participants in this room. */
    fun muteRemoteAudio(mute: Boolean) {
        remoteAudioMuted = mute
        room?.remoteParticipants?.values?.forEach { participant ->
            participant.trackPublications.values
                .filter { it.kind == Track.Kind.AUDIO }
                .forEach { pub -> pub.track?.enabled = !mute }
        }
        broadcastRoom?.remoteParticipants?.values?.forEach { participant ->
            participant.trackPublications.values
                .filter { it.kind == Track.Kind.AUDIO }
                .forEach { pub -> pub.track?.enabled = !mute }
        }
    }

    suspend fun disconnect() = withContext(Dispatchers.Main) {
        disconnectInternal()
    }

    private fun disconnectInternal() {
        eventJob?.cancel()
        eventJob = null
        broadcastEventJob?.cancel()
        broadcastEventJob = null
        // disconnect() closes the signalling/peer connection but does NOT free the native
        // resources. Every LiveKit.create() allocates a PeerConnectionFactory with its own
        // EGL context, and we create TWO rooms per connect (group + all-call). Without
        // release() each reconnect leaked two EGL contexts until the GPU refused more —
        // surfacing as "Failed to create EGL context: 0x3000" on connect, i.e. the device
        // silently stopped being able to join voice until the app/phone was restarted.
        runCatching { room?.disconnect() }
        runCatching { room?.release() }
        room = null
        runCatching { broadcastRoom?.disconnect() }
        runCatching { broadcastRoom?.release() }
        broadcastRoom = null
        remoteAudioMuted = false
        // Reset audio mode so other apps (music, YouTube, etc.) are not affected.
        // LiveKit sets MODE_IN_COMMUNICATION on connect which routes all audio to the earpiece.
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.mode = AudioManager.MODE_NORMAL
        emit(
            VoiceState(
                connected = false,
                talking = false,
                roomName = null,
                floorHolderName = null,
                participantCount = 0,
                error = null,
            ),
        )
    }
}
