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
package com.pushcomm.ptt.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.pushcomm.ptt.PushcommApi
import com.pushcomm.ptt.VoiceSessionManager
import com.pushcomm.ptt.VoiceTokenData
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val TAG = "PushCommPrivateCall"

data class PrivateCallState(
    val isActive: Boolean = false,
    val targetUserId: String = "",
    val targetName: String = "",
    val voiceState: VoiceSessionManager.VoiceState = VoiceSessionManager.VoiceState(),
    val error: String? = null,
)

class PrivateCallViewModel(application: Application) : AndroidViewModel(application) {

    companion object {
        /**
         * True while a private (1-on-1) call is active. Read by
         * PttForegroundService's hardware-button broadcast receiver to know
         * whether to route a hardware PTT to group voice or skip it so the
         * Activity-side keycode can route it to the private-call session.
         */
        val isCallActive = AtomicBoolean(false)
    }

    private val api = PushcommApi()

    // Separate VoiceSessionManager instance — runs alongside group PTT independently
    private val voiceSession = VoiceSessionManager(
        context = application,
        onStateChanged = { vs ->
            _state.value = _state.value.copy(voiceState = vs)
        },
        onDisconnected = {
            // Remote end hung up or network dropped
            _state.value = PrivateCallState()
        },
    )

    private val _state = MutableStateFlow(PrivateCallState())
    val state: StateFlow<PrivateCallState> = _state.asStateFlow()

    init {
        // Mirror state.isActive into the static flag so background components
        // (PttForegroundService) can read it without a binder.
        viewModelScope.launch {
            state.collect { isCallActive.set(it.isActive) }
        }
    }

    /** Initiator: get token with notify=true, connect, then dispatch WS invite. */
    fun startCall(baseUrl: String, token: String, targetUserId: String, targetName: String, userId: String, userName: String) {
        _state.value = PrivateCallState(isActive = true, targetUserId = targetUserId, targetName = targetName)
        viewModelScope.launch {
            try {
                val tokenData = api.getPrivateCallToken(baseUrl, token, targetUserId, notify = true)
                voiceSession.connect(tokenData, userId, userName)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start private call to $targetUserId", e)
                _state.value = _state.value.copy(
                    isActive = true,
                    error = e.message ?: "Private call failed",
                )
            }
        }
    }

    /** Recipient: WS event already delivered; get token with notify=false and connect. */
    fun joinIncoming(
        baseUrl: String,
        token: String,
        initiatorId: String,
        initiatorName: String,
        roomName: String,
        userId: String,
        userName: String,
    ) {
        _state.value = PrivateCallState(isActive = true, targetUserId = initiatorId, targetName = initiatorName)
        viewModelScope.launch {
            try {
                // Ask server for a token to the same deterministic room
                val tokenData = api.getPrivateCallToken(baseUrl, token, initiatorId, notify = false)
                voiceSession.connect(tokenData, userId, userName)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to join private call from $initiatorId", e)
                _state.value = _state.value.copy(
                    isActive = true,
                    error = e.message ?: "Private call failed",
                )
            }
        }
    }

    fun startTalking() {
        viewModelScope.launch {
            try { voiceSession.startTalking() } catch (_: Exception) {}
        }
    }

    fun stopTalking() {
        viewModelScope.launch {
            try { voiceSession.stopTalking() } catch (_: Exception) {}
        }
    }

    fun hangUp(baseUrl: String, token: String) {
        val targetUserId = _state.value.targetUserId
        viewModelScope.launch {
            try { voiceSession.disconnect() } catch (_: Exception) {}
            if (targetUserId.isNotBlank()) {
                try { api.endPrivateCall(baseUrl, token, targetUserId) } catch (_: Exception) {}
            }
        }
        _state.value = PrivateCallState()
    }

    fun remoteEnded() {
        viewModelScope.launch {
            try { voiceSession.disconnect() } catch (_: Exception) {}
        }
        _state.value = PrivateCallState()
    }

    fun disconnectLocal() {
        viewModelScope.launch {
            try { voiceSession.disconnect() } catch (_: Exception) {}
        }
        _state.value = PrivateCallState()
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        viewModelScope.launch { voiceSession.disconnect() }
    }
}
