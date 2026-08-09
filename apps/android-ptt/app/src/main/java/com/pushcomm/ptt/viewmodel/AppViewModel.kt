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
package com.pushcomm.ptt.viewmodel

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.pushcomm.ptt.GroupItem
import com.pushcomm.ptt.MainActivity
import com.pushcomm.ptt.PttForegroundService
import com.pushcomm.ptt.PushcommApi
import com.pushcomm.ptt.PushcommUnauthorizedException
import com.pushcomm.ptt.SessionPreferences
import com.pushcomm.ptt.UserItem
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class SessionState(
    val loggedIn: Boolean = false,
    val loading: Boolean = false,
    val baseUrl: String = "",
    val accessToken: String = "",
    val userId: String = "",
    val userName: String = "",
    val callsign: String = "",
    val groups: List<GroupItem> = emptyList(),
    val users: List<UserItem> = emptyList(),
    val error: String? = null,
)

data class SosUiState(
    val loading: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

data class UserStatusUiState(
    val state: String = "available",
    val label: String = "Available",
    val color: String = "#22c55e",
    val saving: Boolean = false,
    val error: String? = null,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = SessionPreferences(application)
    private val api = PushcommApi()

    private val _session = MutableStateFlow(SessionState())
    val session: StateFlow<SessionState> = _session.asStateFlow()

    private val _unreadCount = MutableStateFlow(0)
    val unreadCount: StateFlow<Int> = _unreadCount.asStateFlow()

    // One-shot event that MessagesListScreen collects to auto-refresh the list
    private val _messageRefreshTrigger = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val messageRefreshTrigger: SharedFlow<Unit> = _messageRefreshTrigger.asSharedFlow()

    // Incoming private PTT call event (walkie-talkie style — auto-join)
    data class PrivateCallEvent(
        val initiatorId: String,
        val initiatorName: String,
        val roomName: String,
    )
    private val _privateCallIncoming = MutableSharedFlow<PrivateCallEvent>(extraBufferCapacity = 1)
    val privateCallIncoming: SharedFlow<PrivateCallEvent> = _privateCallIncoming.asSharedFlow()
    private val _privateCallEnded = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val privateCallEnded: SharedFlow<Unit> = _privateCallEnded.asSharedFlow()

    private val _activeSosId = MutableStateFlow<String?>(null)
    val activeSosId: StateFlow<String?> = _activeSosId.asStateFlow()
    private val _sosUiState = MutableStateFlow(SosUiState())
    val sosUiState: StateFlow<SosUiState> = _sosUiState.asStateFlow()

    private val _userStatus = MutableStateFlow(UserStatusUiState())
    val userStatus: StateFlow<UserStatusUiState> = _userStatus.asStateFlow()

    private val _sosAcknowledged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sosAcknowledged: SharedFlow<Unit> = _sosAcknowledged.asSharedFlow()

    // Hardware PTT key capture
    private val _isCapturingPttKey = MutableStateFlow(false)
    val isCapturingPttKey: StateFlow<Boolean> = _isCapturingPttKey.asStateFlow()

    private val _hardwarePttKeycode = MutableStateFlow(prefs.hardwarePttKeycode)
    val hardwarePttKeycode: StateFlow<Int> = _hardwarePttKeycode.asStateFlow()
    private val _hardwarePttMode = MutableStateFlow(prefs.hardwarePttMode)
    val hardwarePttMode: StateFlow<String> = _hardwarePttMode.asStateFlow()

    fun startPttCapture() { _isCapturingPttKey.value = true }
    fun cancelPttCapture() { _isCapturingPttKey.value = false }

    fun onHardwareKeySelected(keycode: Int) {
        prefs.hardwarePttKeycode = keycode
        _hardwarePttKeycode.value = keycode
        _isCapturingPttKey.value = false
    }

    fun clearHardwarePttKey() {
        prefs.hardwarePttKeycode = -1
        _hardwarePttKeycode.value = -1
    }

    fun setHardwarePttMode(mode: String) {
        val clean = if (mode == "toggle") "toggle" else "hold"
        prefs.hardwarePttMode = clean
        _hardwarePttMode.value = clean
    }

    fun updateServerUrl(newUrl: String) {
        val clean = newUrl.trim().trimEnd('/')
        if (clean.isBlank()) return
        prefs.baseUrl = clean
        _session.value = _session.value.copy(baseUrl = clean)
        openPresenceSocket(clean, _session.value.accessToken)
    }

    // Lone Worker / Man-Down timer — counts down in seconds; null = inactive
    private val _loneWorkerRemaining = MutableStateFlow<Int?>(null)
    val loneWorkerRemaining: StateFlow<Int?> = _loneWorkerRemaining.asStateFlow()
    private var loneWorkerJob: Job? = null

    // WebSocket kept alive with 30-second pings so the API ws-manager counts
    // this device as online in the dispatch GROUP/USERS panel.
    private val wsClient = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private var presenceSocket: WebSocket? = null
    private var tokenRefreshJob: Job? = null
    private var unreadPollingJob: Job? = null
    private var lastUnreadTotal = 0

    init {
        createMessageNotificationChannel()
        tryAutoLogin()
        // Collect urgent refresh requests from PttForegroundService (triggered on 401)
        viewModelScope.launch {
            PttForegroundService.immediateRefreshRequested.collect {
                if (!_session.value.loggedIn) return@collect
                val storedRefreshToken = prefs.refreshToken
                if (storedRefreshToken.isBlank()) return@collect
                try {
                    val data = api.refreshTokens(prefs.baseUrl, storedRefreshToken)
                    prefs.accessToken = data.accessToken
                    prefs.refreshToken = data.refreshToken
                    _session.value = _session.value.copy(accessToken = data.accessToken)
                    openPresenceSocket(prefs.baseUrl, data.accessToken)
                } catch (e: PushcommUnauthorizedException) {
                    // Refresh token genuinely rejected — try password re-login; log
                    // out only if that is also rejected (provisioned devices: no
                    // password, so a truly-dead refresh token ends the session).
                    if (attemptSilentReLogin() == ReLoginResult.AUTH_REJECTED) logout()
                } catch (_: Exception) {
                    // Transient/network — keep the session and retry. A coverage blip
                    // must never log a device out.
                }
            }
        }
        // Hardware SOS button (vendor broadcast caught by the foreground service).
        // Same toggle semantics as the F3 key handler in MainActivity.
        viewModelScope.launch {
            PttForegroundService.sosTriggeredFromHardware.collect {
                if (!_session.value.loggedIn) return@collect
                if (_activeSosId.value == null) {
                    triggerSos(null, null)
                } else {
                    cancelSos()
                }
            }
        }
    }

    private fun createMessageNotificationChannel() {
        val chan = NotificationChannel(
            "pushcomm_messages",
            "PushComm Messages",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = "Incoming message alerts" }
        val nm = getApplication<Application>()
            .getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(chan)
    }

    private fun openPresenceSocket(baseUrl: String, token: String) {
        presenceSocket?.close(1000, null)
        val wsUrl = baseUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://") + "/api/ws?token=$token"
        val req = Request.Builder().url(wsUrl).build()
        presenceSocket = wsClient.newWebSocket(req, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val obj = try { JSONObject(text) } catch (_: Exception) { return }
                when (obj.optString("event")) {
                    "message:created" -> {
                        val senderId = obj.optString("senderId")
                        if (senderId.isNotBlank() && senderId != _session.value.userId && shouldRefreshForMessage(obj)) {
                            refreshUnreadState(senderId, notifyIfIncreased = true)
                        }
                    }
                    "message:read" -> {
                        if (obj.optString("readBy") == _session.value.userId) {
                            refreshUnreadState(notifyIfIncreased = false)
                        }
                    }
                    "private_call:incoming" -> {
                        val targetUserId = obj.optString("targetUserId")
                        if (targetUserId == _session.value.userId) {
                            val initiatorName = buildString {
                                append(obj.optString("initiatorFirstName"))
                                val last = obj.optString("initiatorLastName")
                                if (last.isNotBlank()) { append(" "); append(last) }
                            }.trim().ifBlank { "Someone" }
                            _privateCallIncoming.tryEmit(
                                PrivateCallEvent(
                                    initiatorId = obj.optString("initiatorId"),
                                    initiatorName = initiatorName,
                                    roomName = obj.optString("roomName"),
                                )
                            )
                        }
                    }
                    "private_call:ended" -> {
                        val targetUserId = obj.optString("targetUserId")
                        if (targetUserId == _session.value.userId) {
                            _privateCallEnded.tryEmit(Unit)
                        }
                    }
                    "sos:acknowledged" -> {
                        val sosId = obj.optString("sosId")
                        if (sosId == _activeSosId.value) {
                            _activeSosId.value = null
                            _sosUiState.value = SosUiState(message = "SOS acknowledged by dispatch")
                            _sosAcknowledged.tryEmit(Unit)
                        }
                    }
                    "sos:cancelled" -> {
                        val sosId = obj.optString("sosId")
                        if (sosId == _activeSosId.value) {
                            _activeSosId.value = null
                            _sosUiState.value = SosUiState(message = "SOS cancelled")
                        }
                    }
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                if (_session.value.loggedIn) {
                    viewModelScope.launch {
                        delay(5_000)
                        if (_session.value.loggedIn) openPresenceSocket(baseUrl, token)
                    }
                }
            }
        })
    }

    private fun closePresenceSocket() {
        presenceSocket?.close(1000, null)
        presenceSocket = null
    }

    // Refresh access token every 14 minutes (tokens expire in 15m)
    private fun startTokenRefreshLoop() {
        tokenRefreshJob?.cancel()
        tokenRefreshJob = viewModelScope.launch {
            while (true) {
                delay(14 * 60 * 1_000L)
                if (!_session.value.loggedIn) break
                val storedRefreshToken = prefs.refreshToken
                if (storedRefreshToken.isBlank()) break
                try {
                    val data = api.refreshTokens(prefs.baseUrl, storedRefreshToken)
                    prefs.accessToken = data.accessToken
                    prefs.refreshToken = data.refreshToken
                    _session.value = _session.value.copy(accessToken = data.accessToken)
                    openPresenceSocket(prefs.baseUrl, data.accessToken)
                } catch (e: PushcommUnauthorizedException) {
                    // Refresh token rejected by the server — try a credential
                    // re-login; only give up to the login screen if that is also
                    // rejected. Network errors fall through to the branch below.
                    if (attemptSilentReLogin() == ReLoginResult.AUTH_REJECTED) {
                        logout()
                        break
                    }
                } catch (_: Exception) {
                    // Transient/network — keep the session and retry next cycle.
                }
            }
        }
    }

    private fun stopTokenRefreshLoop() {
        tokenRefreshJob?.cancel()
        tokenRefreshJob = null
    }

    private fun startUnreadPollingLoop() {
        unreadPollingJob?.cancel()
        unreadPollingJob = viewModelScope.launch {
            while (true) {
                delay(30_000)
                if (!_session.value.loggedIn) break
                refreshUnreadState(notifyIfIncreased = false)
            }
        }
    }

    private fun stopUnreadPollingLoop() {
        unreadPollingJob?.cancel()
        unreadPollingJob = null
    }

    private fun shouldRefreshForMessage(obj: JSONObject): Boolean {
        val type = obj.optString("type")
        val userId = _session.value.userId
        return when (type) {
            "direct" -> {
                val targetUserId = obj.optString("targetUserId")
                targetUserId.isBlank() || targetUserId == userId
            }
            "group" -> {
                val targetGroupId = obj.optString("targetGroupId")
                targetGroupId.isBlank() || _session.value.groups.any { it.id == targetGroupId }
            }
            "broadcast" -> true
            else -> true
        }
    }

    private fun tryAutoLogin() {
        if (!prefs.hasSession()) return
        _session.value = _session.value.copy(
            loggedIn = true,
            loading = true,
            baseUrl = prefs.baseUrl,
            accessToken = prefs.accessToken,
            userId = prefs.userId,
            userName = prefs.userName,
            callsign = prefs.callsign,
        )
        viewModelScope.launch {
            try {
                // Proactively refresh so we always start with a fresh 15-min access token,
                // regardless of how old the stored token is (e.g. after Activity recreation).
                val storedRefresh = prefs.refreshToken
                if (storedRefresh.isNotBlank()) {
                    val refreshed = api.refreshTokens(prefs.baseUrl, storedRefresh)
                    prefs.accessToken = refreshed.accessToken
                    prefs.refreshToken = refreshed.refreshToken
                    _session.value = _session.value.copy(accessToken = refreshed.accessToken)
                }
                openPresenceSocket(prefs.baseUrl, prefs.accessToken)
                startTokenRefreshLoop()
                startUnreadPollingLoop()
                val baseUrl = prefs.baseUrl
                val token = prefs.accessToken
                val groups = api.listGroups(baseUrl, token)
                val users = api.listUsers(baseUrl, token)
                    _session.value = _session.value.copy(
                    loading = false,
                    groups = groups,
                    users = users,
                )
                refreshMyStatus(baseUrl, token)
                // Best-effort: fetch current FCM token and register it with the server
                runCatching {
                    val fcmToken = FirebaseMessaging.getInstance().token.await()
                    if (fcmToken.isNotBlank()) {
                        prefs.fcmToken = fcmToken
                        api.postFcmToken(baseUrl, token, fcmToken)
                    }
                }
                refreshUnreadState(notifyIfIncreased = false)
            } catch (e: PushcommUnauthorizedException) {
                // Refresh token genuinely rejected — try a credential re-login; only
                // fall back to the login screen if the password is also rejected
                // (provisioned devices have no password, so a dead refresh token
                // ends the session here).
                when (attemptSilentReLogin()) {
                    ReLoginResult.AUTH_REJECTED -> {
                        stopTokenRefreshLoop()
                        stopUnreadPollingLoop()
                        closePresenceSocket()
                        prefs.clear()
                        _session.value = SessionState(error = "Session expired. Please log in.")
                        return@launch
                    }
                    else -> {
                        startTokenRefreshLoop()
                        startUnreadPollingLoop()
                        runCatching {
                            val groups = api.listGroups(prefs.baseUrl, prefs.accessToken)
                            val users = api.listUsers(prefs.baseUrl, prefs.accessToken)
                            _session.value = _session.value.copy(loading = false, groups = groups, users = users)
                        }.onFailure {
                            _session.value = _session.value.copy(loading = false)
                        }
                    }
                }
            } catch (_: Exception) {
                // Transient/network at cold start — keep the restored session and
                // start the loops; they recover when the network returns. A device
                // booting out of coverage (especially a provisioned device with no
                // stored password) must never be stranded at the login screen.
                startTokenRefreshLoop()
                startUnreadPollingLoop()
                runCatching {
                    val groups = api.listGroups(prefs.baseUrl, prefs.accessToken)
                    val users = api.listUsers(prefs.baseUrl, prefs.accessToken)
                    _session.value = _session.value.copy(loading = false, groups = groups, users = users)
                }.onFailure {
                    _session.value = _session.value.copy(loading = false)
                }
            }
        }
    }

    fun login(baseUrl: String, username: String, password: String) {
        val cleanUrl = baseUrl.trim().trimEnd('/')
        _session.value = _session.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val login = api.login(cleanUrl, username, password)
                finishLogin(cleanUrl, username, password, login)
            } catch (e: Exception) {
                _session.value = _session.value.copy(
                    loading = false,
                    error = e.message ?: "Login failed",
                )
            }
        }
    }

    private enum class ReLoginResult { SUCCESS, AUTH_REJECTED, TRANSIENT }

    /**
     * Silently re-authenticate with the stored (encrypted) credentials when a
     * token refresh fails — so a field operator is never dumped back to the
     * login screen. Lightweight: refreshes tokens + session + presence socket
     * without restarting the background loops or re-fetching groups/users.
     *
     * Returns AUTH_REJECTED only when the server actually rejects the password
     * (or no credentials are stored); a network/transient error returns
     * TRANSIENT so the caller keeps the session and retries later.
     */
    private suspend fun attemptSilentReLogin(): ReLoginResult {
        val baseUrl = prefs.baseUrl
        val username = prefs.savedUsername
        val password = prefs.savedPassword
        if (baseUrl.isBlank() || username.isBlank() || password.isBlank()) return ReLoginResult.AUTH_REJECTED
        return try {
            val login = api.login(baseUrl, username, password)
            val userId = login.user?.id.orEmpty()
            val userName = "${login.user?.firstName.orEmpty()} ${login.user?.lastName.orEmpty()}".trim()
            val callsign = login.user?.username?.takeIf { it.isNotBlank() } ?: username
            prefs.saveLoginResult(baseUrl, username, login.accessToken, login.refreshToken, userId, userName, callsign)
            prefs.savedPassword = password
            _session.value = _session.value.copy(
                loggedIn = true,
                loading = false,
                baseUrl = baseUrl,
                accessToken = login.accessToken,
                userId = userId,
                userName = userName,
                callsign = callsign,
            )
            openPresenceSocket(baseUrl, login.accessToken)
            ReLoginResult.SUCCESS
        } catch (e: PushcommUnauthorizedException) {
            ReLoginResult.AUTH_REJECTED
        } catch (e: Exception) {
            ReLoginResult.TRANSIENT
        }
    }

    /**
     * Checks if PushcommFcmService stored a pending incoming call while the app was killed.
     * Emits it to [privateCallIncoming] so MainScreen can auto-navigate to PrivateCallScreen.
     */
    fun checkPendingCall() {
        val initiatorId = prefs.pendingCallInitiatorId
        val roomName = prefs.pendingCallRoomName
        if (initiatorId.isBlank() || roomName.isBlank()) return
        val initiatorName = prefs.pendingCallInitiatorName.ifBlank { "Someone" }
        prefs.clearPendingCall()
        _privateCallIncoming.tryEmit(PrivateCallEvent(initiatorId, initiatorName, roomName))
    }

    private fun refreshUnreadState(senderId: String? = null, notifyIfIncreased: Boolean) {
        val s = _session.value
        if (!s.loggedIn) return
        val senderName = s.users
            .firstOrNull { it.id == senderId }
            ?.let { "${it.firstName} ${it.lastName}".trim() }
            ?: "Someone"
        viewModelScope.launch {
            try {
                val convos = api.listConversations(s.baseUrl, s.accessToken)
                val total = convos.direct.sumOf { it.unread_count } +
                            convos.group.sumOf { it.unread_count }
                _unreadCount.value = total
                _messageRefreshTrigger.tryEmit(Unit)
                if (notifyIfIncreased && total > lastUnreadTotal) showMessageNotification(senderName)
                lastUnreadTotal = total
            } catch (_: Exception) { }
        }
    }

    private fun refreshMyStatus(baseUrl: String, accessToken: String) {
        viewModelScope.launch {
            runCatching {
                api.getMyStatus(baseUrl, accessToken)
            }.onSuccess { status ->
                if (status != null) {
                    _userStatus.value = UserStatusUiState(
                        state = status.state,
                        label = status.label ?: status.state.replace('_', ' '),
                        color = status.color ?: statusColorFallback(status.state),
                    )
                }
            }
        }
    }

    fun provisionFromQr(rawPayload: String) {
        val parsed = parseProvisioningPayload(rawPayload)
        if (parsed == null) {
            _session.value = _session.value.copy(
                loading = false,
                error = "Invalid PushComm provisioning QR",
            )
            return
        }
        provisionWithCode(parsed.first, parsed.second)
    }

    fun provisionWithCode(baseUrl: String, code: String) {
        val cleanUrl = baseUrl.trim().trimEnd('/')
        val cleanCode = code.trim()
        if (cleanUrl.isBlank() || cleanCode.isBlank()) {
            _session.value = _session.value.copy(error = "Server URL and provisioning code are required")
            return
        }
        _session.value = _session.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val login = api.provisionDevice(cleanUrl, cleanCode)
                val username = login.user?.let { it.id } ?: "provisioned-device"
                // Pre-seed the saved group from the device's assignment so the
                // PTT screen auto-connects on first launch instead of forcing
                // the user to pick a group manually.
                login.device?.assignedGroupId?.takeIf { it.isNotBlank() }?.let { gid ->
                    prefs.selectedGroupId = gid
                }
                // No password on the QR/code-provisioning path; the device relies
                // on its rolling refresh token. (Credential auto-login applies to
                // username/password logins.)
                finishLogin(cleanUrl, username, "", login)
            } catch (e: Exception) {
                _session.value = _session.value.copy(
                    loading = false,
                    error = e.message ?: "Provisioning failed",
                )
            }
        }
    }

    private fun parseProvisioningPayload(rawPayload: String): Pair<String, String>? {
        val trimmed = rawPayload.trim()
        return try {
            if (trimmed.startsWith("{")) {
                val obj = JSONObject(trimmed)
                val type = obj.optString("type")
                val serverUrl = obj.optString("serverUrl").trim().trimEnd('/')
                val code = obj.optString("code").trim()
                if (type == "pushcomm-device-provisioning" && serverUrl.isNotBlank() && code.isNotBlank()) {
                    serverUrl to code
                } else null
            } else if (trimmed.startsWith("pushcomm://provision")) {
                val uri = android.net.Uri.parse(trimmed)
                val serverUrl = uri.getQueryParameter("serverUrl")?.trim()?.trimEnd('/').orEmpty()
                val code = uri.getQueryParameter("code")?.trim().orEmpty()
                if (serverUrl.isNotBlank() && code.isNotBlank()) serverUrl to code else null
            } else null
        } catch (_: Exception) {
            null
        }
    }

    private suspend fun finishLogin(cleanUrl: String, username: String, password: String, login: com.pushcomm.ptt.LoginData) {
        val token = login.accessToken
        val userId = login.user?.id.orEmpty()
        val userName = "${login.user?.firstName.orEmpty()} ${login.user?.lastName.orEmpty()}".trim()
        // Prefer the username returned by the server (authoritative); fall back
        // to whatever the user typed at the login screen if the server omitted it.
        val callsign = login.user?.username?.takeIf { it.isNotBlank() } ?: username

        prefs.saveLoginResult(
            baseUrl = cleanUrl,
            username = username,
            accessToken = token,
            refreshToken = login.refreshToken,
            userId = userId,
            userName = userName,
            callsign = callsign,
        )
        // Stored (encrypted) so the app can silently re-authenticate when tokens
        // expire — operators are never stranded at the login screen.
        prefs.savedPassword = password

        val groups = api.listGroups(cleanUrl, token)
        val users = api.listUsers(cleanUrl, token)
        _session.value = SessionState(
            loggedIn = true,
            loading = false,
            baseUrl = cleanUrl,
            accessToken = token,
            userId = userId,
            userName = userName,
            callsign = callsign,
            groups = groups,
            users = users,
        )
        openPresenceSocket(cleanUrl, token)
        startTokenRefreshLoop()
        startUnreadPollingLoop()
        refreshMyStatus(cleanUrl, token)
        runCatching {
            val fcmToken = FirebaseMessaging.getInstance().token.await()
            if (fcmToken.isNotBlank()) {
                prefs.fcmToken = fcmToken
                api.postFcmToken(cleanUrl, token, fcmToken)
            }
        }
        refreshUnreadState(notifyIfIncreased = false)
    }

    fun setMyStatus(state: String, label: String, color: String) {
        val current = _session.value
        if (!current.loggedIn || current.baseUrl.isBlank() || current.accessToken.isBlank()) {
            _userStatus.value = _userStatus.value.copy(error = "Not connected")
            return
        }

        _userStatus.value = UserStatusUiState(state = state, label = label, color = color, saving = true)
        viewModelScope.launch {
            runCatching {
                api.setMyStatus(current.baseUrl, current.accessToken, state)
            }.onSuccess { saved ->
                _userStatus.value = UserStatusUiState(
                    state = saved.state,
                    label = saved.label ?: label,
                    color = saved.color ?: color,
                )
            }.onFailure { e ->
                _userStatus.value = _userStatus.value.copy(
                    saving = false,
                    error = e.message ?: "Status update failed",
                )
            }
        }
    }

    private fun statusColorFallback(state: String): String = when (state) {
        "available" -> "#22c55e"
        "busy" -> "#a855f7"
        "en_route" -> "#38bdf8"
        "on_scene" -> "#f59e0b"
        "break" -> "#64748b"
        "unavailable" -> "#ef4444"
        "off_duty" -> "#64748b"
        "emergency" -> "#dc2626"
        else -> "#94a3b8"
    }

    private fun showMessageNotification(senderName: String) {
        val ctx = getApplication<Application>()
        val intent = PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(ctx, "pushcomm_messages")
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("New message from $senderName")
            .setContentText("Tap to open")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(intent)
            .build()
        NotificationManagerCompat.from(ctx).notify(1002, notification)
    }

    fun clearUnreadCount() {
        _unreadCount.value = 0
        // lastUnreadTotal stays as-is so the next checkAndNotify() only fires for genuinely new messages
    }

    fun triggerSos(latitude: Double?, longitude: Double?) {
        val baseUrl = _session.value.baseUrl
        val accessToken = _session.value.accessToken
        if (baseUrl.isBlank() || accessToken.isBlank()) {
            _sosUiState.value = SosUiState(error = "Not connected")
            return
        }
        viewModelScope.launch {
            _sosUiState.value = SosUiState(loading = true)
            runCatching {
                val id = api.triggerSos(baseUrl, accessToken, latitude, longitude)
                if (id.isNotBlank()) {
                    _activeSosId.value = id
                    _sosUiState.value = SosUiState(message = "SOS sent")
                } else {
                    _sosUiState.value = SosUiState(error = "SOS failed")
                }
            }.onFailure { e ->
                _sosUiState.value = SosUiState(error = e.message ?: "SOS failed")
            }
        }
    }

    fun cancelSos() {
        val id = _activeSosId.value
        val baseUrl = _session.value.baseUrl
        val accessToken = _session.value.accessToken
        if (id.isNullOrBlank()) {
            _activeSosId.value = null
            return
        }
        if (baseUrl.isBlank() || accessToken.isBlank()) {
            _sosUiState.value = SosUiState(error = "Not connected")
            return
        }
        viewModelScope.launch {
            _sosUiState.value = SosUiState(loading = true)
            runCatching {
                api.cancelSos(baseUrl, accessToken, id)
                _activeSosId.value = null
                _sosUiState.value = SosUiState(message = "SOS cancelled")
            }.onFailure { e ->
                _sosUiState.value = SosUiState(error = e.message ?: "Cancel SOS failed")
            }
        }
    }

    fun clearSosFeedback() {
        _sosUiState.value = _sosUiState.value.copy(message = null, error = null)
    }

    fun startLoneWorker(minutes: Int) {
        loneWorkerJob?.cancel()
        var remaining = minutes * 60
        _loneWorkerRemaining.value = remaining
        loneWorkerJob = viewModelScope.launch {
            while (remaining > 0) {
                delay(1000)
                remaining--
                _loneWorkerRemaining.value = remaining
            }
            _loneWorkerRemaining.value = null
            _sosUiState.value = SosUiState(message = "Lone Worker expired, sending SOS")
            triggerSos(null, null)
        }
    }

    fun cancelLoneWorker() {
        loneWorkerJob?.cancel()
        loneWorkerJob = null
        _loneWorkerRemaining.value = null
    }

    enum class PinVerifyResult { VALID, INVALID, ERROR }

    /**
     * Verify the admin logout PIN against the server (department setting). The
     * PIN is server-side only — we send the entered value and get back valid/
     * invalid. ERROR means the server couldn't be reached (logout needs a
     * connection, by design).
     */
    fun verifyAdminPin(pin: String, onResult: (PinVerifyResult) -> Unit) {
        val s = _session.value
        viewModelScope.launch {
            val result = try {
                if (api.verifyAdminPin(s.baseUrl, s.accessToken, pin)) {
                    PinVerifyResult.VALID
                } else {
                    PinVerifyResult.INVALID
                }
            } catch (e: Exception) {
                PinVerifyResult.ERROR
            }
            onResult(result)
        }
    }

    fun logout() {
        val baseUrl = _session.value.baseUrl
        val accessToken = _session.value.accessToken
        stopTokenRefreshLoop()
        stopUnreadPollingLoop()
        closePresenceSocket()
        prefs.clear()
        lastUnreadTotal = 0
        _unreadCount.value = 0
        _activeSosId.value = null
        _sosUiState.value = SosUiState()
        _userStatus.value = UserStatusUiState()
        _session.value = SessionState()
        // Best-effort: clear FCM token from server so no notifications arrive after logout
        if (baseUrl.isNotBlank() && accessToken.isNotBlank()) {
            viewModelScope.launch { runCatching { api.clearFcmToken(baseUrl, accessToken) } }
        }
    }

    fun savedBaseUrl(): String = prefs.baseUrl
    fun savedUsername(): String = prefs.savedUsername
    fun savedGroupId(): String = prefs.selectedGroupId

    fun saveSelectedGroup(groupId: String) {
        prefs.selectedGroupId = groupId
    }
}
