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

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.Binder
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Foreground service that keeps the LiveKit PTT connection alive when the
 * app is backgrounded or the screen is off.
 *
 * Responsibilities:
 *  - Holds the VoiceSessionManager (and thus the LiveKit Room) in a long-lived coroutine scope
 *  - Displays a persistent notification showing channel + participant count
 *  - Auto-reconnects with exponential backoff when the network drops
 *  - Exposes startTalking() / stopTalking() so the Activity can forward PTT events
 */
class PttForegroundService : Service() {

    // ----------------------------------------------------------------
    //  Companion / constants
    // ----------------------------------------------------------------

    companion object {
        const val CHANNEL_ID = "pushcomm_ptt"
        const val NOTIFICATION_ID = 1
        const val ACTION_DISCONNECT = "com.pushcomm.ptt.ACTION_DISCONNECT"

        /** Emitted when the service detects a 401 — AppViewModel refreshes immediately. */
        val immediateRefreshRequested = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

        /**
         * Emitted when the service receives a hardware SOS broadcast (a device
         * button or any vendor SOS broadcast). AppViewModel collects this and
         * triggers/cancels SOS through the normal API path.
         */
        val sosTriggeredFromHardware = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

        // ── Hardware-button broadcasts ────────────────────────────────────
        // PTT broadcast actions used by common rugged-handset firmwares.
        // Sent without setPackage(), so any RECEIVER_EXPORTED receiver catches them.
        // Listened to from the foreground service so they are still delivered
        // when the screen is off and MainActivity is paused/stopped.
        private val PTT_DOWN_ACTIONS = setOf(
            "com.ptt1.action.PTT.down",
            "com.ptt2.action.PTT.down",
            "com.ptt1.action.PTT.long",
            "com.ptt2.action.PTT.long",
            "android.intent.action.ptt.down",
            "android.intent.action.PTT.down",
            "android.xin.PTT.start",
        )
        private val PTT_UP_ACTIONS = setOf(
            "com.ptt1.action.PTT.up",
            "com.ptt2.action.PTT.up",
            "android.intent.action.ptt.up",
            "android.intent.action.PTT.up",
            "android.xin.PTT.end",
        )
        // SOS action names deliberately wide — handset firmware does not yet
        // confirm any of these. Verified via logcat once a real SOS broadcast
        // is observed; non-matching names are harmless filter entries.
        private val SOS_DOWN_ACTIONS = setOf(
            "android.intent.action.SOS.down",
            "android.intent.action.SOS",
            "com.sos.action.SOS.down",
            "com.ptt1.action.SOS.down",
            "com.ptt2.action.SOS.down",
            "android.xin.SOS.start",
        )

        private const val EXTRA_BASE_URL = "base_url"
        private const val EXTRA_ACCESS_TOKEN = "access_token"
        private const val EXTRA_GROUP_ID = "group_id"
        private const val EXTRA_GROUP_NAME = "group_name"
        private const val EXTRA_USER_ID = "user_id"
        private const val EXTRA_USER_NAME = "user_name"

        /** Start the service and immediately connect to [groupId]. */
        fun startIntent(
            context: Context,
            baseUrl: String,
            accessToken: String,
            groupId: String,
            groupName: String,
            userId: String,
            userName: String,
        ): Intent = Intent(context, PttForegroundService::class.java).apply {
            putExtra(EXTRA_BASE_URL, baseUrl)
            putExtra(EXTRA_ACCESS_TOKEN, accessToken)
            putExtra(EXTRA_GROUP_ID, groupId)
            putExtra(EXTRA_GROUP_NAME, groupName)
            putExtra(EXTRA_USER_ID, userId)
            putExtra(EXTRA_USER_NAME, userName)
        }
    }

    // ----------------------------------------------------------------
    //  Binder — Activity uses this to get a direct reference
    // ----------------------------------------------------------------

    inner class LocalBinder : Binder() {
        fun getService(): PttForegroundService = this@PttForegroundService
    }

    private val binder = LocalBinder()
    override fun onBind(intent: Intent?): IBinder = binder

    // ----------------------------------------------------------------
    //  Internal state
    // ----------------------------------------------------------------

    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val api = PushcommApi()
    private lateinit var prefs: SessionPreferences

    private lateinit var voiceSession: VoiceSessionManager

    private val _voiceState = MutableStateFlow(VoiceSessionManager.VoiceState())
    val voiceState: StateFlow<VoiceSessionManager.VoiceState> = _voiceState.asStateFlow()

    // Connection params — needed for token refresh on reconnect
    private var baseUrl = ""
    private var accessToken = ""
    private var groupId = ""
    private var groupName = ""
    private var userId = ""
    private var userName = ""

    private var reconnectJob: Job? = null
    private var connectJob: Job? = null
    private var reconnectAttempt = 0
    private val reconnectDelaysMs = listOf(2_000L, 4_000L, 8_000L, 16_000L, 30_000L)
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var activeNetwork: Network? = null
    private var lastLinkAddresses: Set<String> = emptySet()

    // ── GPS posting — runs inside the foreground service to survive Doze/background ──
    private val fusedClient by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private var locationThread: HandlerThread? = null
    private var locationCallback: LocationCallback? = null

    // ── Wake lock + hardware-button receiver ──────────────────────────────
    // Partial wake lock keeps the CPU running with the screen off so that
    // incoming broadcasts (PTT/SOS) and audio frames are processed promptly.
    // The hardware-button receiver lives here (not in MainActivity) so that
    // PTT and SOS broadcasts are delivered even when the Activity is paused.
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var hardwareKeyReceiver: BroadcastReceiver? = null

    // Diagnostic MediaSession to catch BT-mic button presses (INRICO B01 and
    // similar). BT PTT mics typically don't register as Android HID input
    // devices; their buttons fire ACTION_MEDIA_BUTTON which only routes to
    // the currently-active media session. Keeping this session active (state
    // = STATE_PLAYING, even though we're not playing media) makes us the
    // recipient. The callback below logs every event to logcat so we can
    // identify what each B01 button actually sends, then wire them to PTT/SOS.
    private var mediaSession: MediaSession? = null

    // Vendor-channel scraper for PTT mics whose buttons fire NEITHER HID
    // events NOR ACTION_MEDIA_BUTTON. Confirmed for INRICO B01: only
    // volume keys come through standard channels. See BtMicListener for
    // the SPP + BLE GATT scraping strategy.
    private var btMicListener: BtMicListener? = null

    // ----------------------------------------------------------------
    //  Lifecycle
    // ----------------------------------------------------------------

    override fun onCreate() {
        super.onCreate()
        prefs = SessionPreferences(this)
        createNotificationChannel()
        voiceSession = VoiceSessionManager(this,
            onStateChanged = { state ->
                _voiceState.value = state
                updateNotification(state)
            },
            onDisconnected = {
                scheduleReconnect()
            }
        )
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "Pushcomm:PttButtons",
        ).apply { setReferenceCounted(false) }
        // WiFi high-perf lock keeps the radio out of power-save mode so the
        // first audio packet after PTT-press doesn't have to wait for WiFi to
        // re-associate. Without this, screen-off PTT had a ~1s start delay.
        val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
        wifiLock = wm.createWifiLock(
            WifiManager.WIFI_MODE_FULL_HIGH_PERF,
            "Pushcomm:WifiHighPerf",
        ).apply { setReferenceCounted(false) }
        registerHardwareKeyReceiver()
        registerBtMicMediaSession()
        startBtMicListener()
        // Note: startForeground is called in onStartCommand, not here.
        // This allows the Activity to bind (BIND_AUTO_CREATE) without triggering
        // a foreground notification until the user actually presses Connect.
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISCONNECT) {
            disconnect()
            stopSelf()
            return START_NOT_STICKY
        }

        // Must call startForeground() quickly when started via startForegroundService().
        // Promote to foreground with a "Connecting..." notification.
        startForeground(NOTIFICATION_ID, buildNotification("Connecting...", ""))

        // Hold the wake + WiFi locks for as long as the foreground service runs
        // so that hardware-button broadcasts and audio frames are processed
        // promptly even with the screen off.
        runCatching {
            if (wakeLock?.isHeld != true) wakeLock?.acquire()
            if (wifiLock?.isHeld != true) wifiLock?.acquire()
        }

        intent?.let {
            val nBase = it.getStringExtra(EXTRA_BASE_URL) ?: return@let
            val nToken = it.getStringExtra(EXTRA_ACCESS_TOKEN) ?: return@let
            val nGroup = it.getStringExtra(EXTRA_GROUP_ID) ?: return@let
            val nGroupName = it.getStringExtra(EXTRA_GROUP_NAME) ?: ""
            val nUserId = it.getStringExtra(EXTRA_USER_ID) ?: ""
            val nUserName = it.getStringExtra(EXTRA_USER_NAME) ?: ""

            // Idempotent start: a redundant start command for the SAME group while we're
            // already connected (or actively connecting) must NOT tear down the live room.
            // Reconnecting on every startForegroundService churned the LiveKit connection,
            // so PTT frequently fired mid-reconnect → no floor grant, no beep, no audio.
            // (A repeated group tap, an auto-connect re-fire, or a recomposition all land here.)
            val sameTarget = nGroup == groupId && nUserId == userId && nBase == baseUrl
            val live = _voiceState.value.connected || connectJob?.isActive == true

            baseUrl = nBase
            accessToken = nToken
            groupId = nGroup
            groupName = nGroupName
            userId = nUserId
            userName = nUserName

            if (sameTarget && live) {
                updateNotification(if (_voiceState.value.connected) "Connected" else "Connecting…", nGroupName)
            } else {
                reconnectAttempt = 0
                registerNetworkCallback()
                connectNow()
            }
        }

        // START_STICKY: system restarts service if killed, re-delivers last intent
        return START_STICKY
    }

    override fun onDestroy() {
        reconnectJob?.cancel()
        unregisterNetworkCallback()
        unregisterHardwareKeyReceiver()
        runCatching { mediaSession?.isActive = false; mediaSession?.release() }
        mediaSession = null
        runCatching { btMicListener?.stop() }
        btMicListener = null
        runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
        runCatching { if (wifiLock?.isHeld == true) wifiLock?.release() }
        stopGps()
        serviceScope.launch { voiceSession.disconnect() }
        // Safety net: reset audio mode synchronously in case the coroutine above
        // doesn't complete before the process is killed.
        (getSystemService(AUDIO_SERVICE) as AudioManager).mode = AudioManager.MODE_NORMAL
        super.onDestroy()
    }

    // ----------------------------------------------------------------
    //  Bluetooth mic media-button receiver (diagnostic + future wiring)
    // ----------------------------------------------------------------

    /**
     * Register a MediaSession that grabs ACTION_MEDIA_BUTTON events from
     * Bluetooth audio peripherals (PTT mics, headsets, earpieces). The
     * callback logs every received keycode under the `BtMicKey` tag so we
     * can identify exactly what each button on a paired BT device sends.
     *
     * Why an active MediaSession is needed: Android routes media buttons
     * (ACTION_MEDIA_BUTTON intents) to the most-recently-active media
     * session. Without registering one, BT mic PTT/SOS buttons are silently
     * dropped — that's why volume up/down "just work" (separate Bluetooth
     * absolute-volume path) but PTT does not.
     *
     * We set state = STATE_PLAYING even though no audio is playing, because
     * non-playing sessions don't always win the routing. Once we know what
     * keycodes a given BT mic produces, we map them to startTalking() /
     * stopTalking() / SOS the same way the hardware-button receiver
     * does for built-in buttons.
     */
    private fun registerBtMicMediaSession() {
        if (mediaSession != null) return
        runCatching {
            val session = MediaSession(this, "PushcommBtMic")
            session.setCallback(object : MediaSession.Callback() {
                override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
                    val ev = mediaButtonIntent.getParcelableExtra(
                        Intent.EXTRA_KEY_EVENT,
                        android.view.KeyEvent::class.java,
                    )
                    if (ev == null) {
                        Log.w("BtMicKey", "media button intent with no KeyEvent: $mediaButtonIntent")
                        return false
                    }
                    Log.i(
                        "BtMicKey",
                        "action=${ev.action} keycode=${ev.keyCode} (${android.view.KeyEvent.keyCodeToString(ev.keyCode)}) " +
                            "source=${ev.source} device=${ev.deviceId} repeat=${ev.repeatCount}",
                    )
                    // For now: passively log only. Once we know what each
                    // physical button maps to, this is where the switch to
                    // startTalking() / stopTalking() / SOS goes.
                    return true
                }
            })
            session.setPlaybackState(
                PlaybackState.Builder()
                    .setActions(
                        PlaybackState.ACTION_PLAY or
                            PlaybackState.ACTION_PAUSE or
                            PlaybackState.ACTION_PLAY_PAUSE or
                            PlaybackState.ACTION_STOP or
                            PlaybackState.ACTION_SKIP_TO_NEXT or
                            PlaybackState.ACTION_SKIP_TO_PREVIOUS,
                    )
                    .setState(PlaybackState.STATE_PLAYING, 0L, 1.0f)
                    .build(),
            )
            session.isActive = true
            mediaSession = session
            Log.i("BtMicKey", "MediaSession registered + active")
        }.onFailure {
            Log.w("BtMicKey", "MediaSession registration failed: ${it.message}")
        }
    }

    /**
     * Start the vendor-channel scraper that captures button events from
     * BT mics whose buttons bypass both HID and AVRCP (INRICO B01 et al).
     * The four callback methods route into the existing PTT/SOS flow so
     * once a button is identified, no additional plumbing is needed.
     */
    private fun startBtMicListener() {
        if (btMicListener != null) return
        btMicListener = BtMicListener(
            context = this,
            callbacks = object : BtMicListener.Callbacks {
                override fun onPttPressed() = this@PttForegroundService.onBtMicPttPressed()
                override fun onPttReleased() = this@PttForegroundService.onBtMicPttReleased()
                override fun onSosTriggered() = this@PttForegroundService.onBtMicSosTriggered()
                override fun onUnlabeledButtonPressed() = this@PttForegroundService.onBtMicUnlabeled()
            },
        ).also { it.start() }
    }

    // ── BT mic button handlers ────────────────────────────────────────
    // Mirror the hardware-button receiver: same private-call routing
    // guard, same startTalking/stopTalking entry points. SOS goes through
    // the shared sosTriggeredFromHardware flow that a hardware SOS key
    // handler already uses, so dispatch / Lone Worker / etc. all behave
    // identically regardless of where the SOS originated.

    private fun onBtMicPttPressed() {
        if (com.pushcomm.ptt.viewmodel.PrivateCallViewModel.isCallActive.get()) return
        startTalking()
    }

    private fun onBtMicPttReleased() {
        if (com.pushcomm.ptt.viewmodel.PrivateCallViewModel.isCallActive.get()) return
        stopTalking()
    }

    private fun onBtMicSosTriggered() {
        sosTriggeredFromHardware.tryEmit(Unit)
    }

    private fun onBtMicUnlabeled() {
        // Channel/group switch — placeholder. Definition is pending the
        // protocol decode; for now we just log so we know it fired.
        Log.i("BtMicScrape", "unlabeled button fired (no action wired yet)")
    }

    // ----------------------------------------------------------------
    //  Hardware-button broadcast receiver
    // ----------------------------------------------------------------

    private fun registerHardwareKeyReceiver() {
        if (hardwareKeyReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val action = intent?.action ?: return
                Log.d("PTT_BCAST_SVC", "onReceive action=$action")
                when {
                    action in PTT_DOWN_ACTIONS -> {
                        // If a private call is active, the Activity-side
                        // keycode handler routes PTT to that call; service
                        // would otherwise transmit to group simultaneously.
                        if (com.pushcomm.ptt.viewmodel.PrivateCallViewModel.isCallActive.get()) return
                        startTalking()
                    }
                    action in PTT_UP_ACTIONS -> {
                        if (com.pushcomm.ptt.viewmodel.PrivateCallViewModel.isCallActive.get()) return
                        stopTalking()
                    }
                    action in SOS_DOWN_ACTIONS -> sosTriggeredFromHardware.tryEmit(Unit)
                }
            }
        }
        val filter = IntentFilter().apply {
            (PTT_DOWN_ACTIONS + PTT_UP_ACTIONS + SOS_DOWN_ACTIONS).forEach { addAction(it) }
        }
        ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
        hardwareKeyReceiver = receiver
    }

    private fun unregisterHardwareKeyReceiver() {
        val r = hardwareKeyReceiver ?: return
        runCatching { unregisterReceiver(r) }
        hardwareKeyReceiver = null
    }

    // ----------------------------------------------------------------
    //  Public API (called by Activity via bound service)
    // ----------------------------------------------------------------

    fun startTalking() {
        serviceScope.launch { voiceSession.startTalking() }
    }

    fun stopTalking() {
        serviceScope.launch { voiceSession.stopTalking() }
    }

    fun disconnect() {
        connectJob?.cancel()
        connectJob = null
        reconnectJob?.cancel()
        reconnectJob = null
        reconnectAttempt = 0
        unregisterNetworkCallback() // also clears activeNetwork
        stopGps()
        serviceScope.launch { voiceSession.disconnect() }
    }

    fun isConnected(): Boolean = _voiceState.value.connected

    /** Called by MainActivity when AppViewModel refreshes the JWT access token. */
    fun updateToken(newToken: String) {
        val tokenChanged = newToken != accessToken
        accessToken = newToken
        // If we're stuck in backoff with an expired token, reconnect immediately with the new one
        if (tokenChanged && !_voiceState.value.connected) {
            reconnectJob?.cancel()
            reconnectAttempt = 0
            connectNow()
        }
    }

    fun muteRemoteAudio(mute: Boolean) {
        voiceSession.muteRemoteAudio(mute)
    }

    // ── GPS posting ────────────────────────────────────────────────────────────

    /**
     * Start posting GPS to the server. Uses a HandlerThread looper (NOT the main looper)
     * so callbacks are delivered even when Android Doze suppresses the UI thread.
     * Safe to call multiple times — stops the previous callback first.
     */
    @SuppressLint("MissingPermission")
    fun startGps() {
        stopGps() // always clean up before re-registering

        // Sanity-check permission BEFORE registering. Silent SecurityException
        // catches were leaving operators staring at a stale GPS marker without
        // any signal that posting had been disabled. Log loudly here so that
        // `adb logcat -s PttGps` answers "why isn't this device showing on the
        // map?" in one line.
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.ACCESS_FINE_LOCATION,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                this,
                android.Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) {
            Log.w("PttGps", "startGps: location permission NOT granted; GPS posting will not run")
            return
        }

        val thread = HandlerThread("pushcomm-gps").also { it.start() }
        locationThread = thread

        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: run {
                    Log.w("PttGps", "onLocationResult: result.lastLocation == null")
                    return
                }
                // Store-and-forward: enqueue every fix; the uploader delivers it now (online) or
                // backfills later (offline) → gap-free tracks + a live map that survives dead zones.
                LocationUploader.submit(
                    applicationContext,
                    QueuedFix(
                        id = 0L,
                        latitude = loc.latitude,
                        longitude = loc.longitude,
                        accuracy = if (loc.hasAccuracy()) loc.accuracy else null,
                        speed = if (loc.hasSpeed()) loc.speed else null,
                        heading = if (loc.hasBearing()) loc.bearing else null,
                        altitude = if (loc.hasAltitude()) loc.altitude else null,
                        ts = if (loc.time > 0) loc.time else System.currentTimeMillis(),
                    ),
                )
            }
        }
        locationCallback = cb
        // Periodic drain: flushes any buffered/backlogged fixes even between GPS updates
        // and after connectivity returns.
        LocationUploader.start(applicationContext)

        // HIGH_ACCURACY = true GNSS (~5-10m). BALANCED gives ~100m Wi-Fi/cell fixes,
        // fine for a map dot but too coarse for road-level tracking/telematics (it
        // produced ~90m scatter + km-scale outliers that broke map-matching).
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 15_000L)
            .setMinUpdateIntervalMillis(8_000L)
            .build()

        try {
            fusedClient.requestLocationUpdates(req, cb, thread.looper)
            Log.i("PttGps", "startGps: requestLocationUpdates registered (30s interval)")
        } catch (e: SecurityException) {
            Log.e("PttGps", "startGps: SecurityException despite permission check", e)
            stopGps()
        }
    }

    fun stopGps() {
        locationCallback?.let { fusedClient.removeLocationUpdates(it) }
        locationCallback = null
        locationThread?.quitSafely()
        locationThread = null
    }

    // ----------------------------------------------------------------
    //  Internal connect / reconnect logic
    // ----------------------------------------------------------------

    private fun connectNow() {
        connectJob?.cancel()
        connectJob = serviceScope.launch {
            try {
                updateNotification("Requesting token...", "")
                // Always use the freshest access token — AppViewModel refreshes prefs every 14 min
                val currentToken = prefs.accessToken.ifBlank { accessToken }
                val tokenData = api.requestGroupVoiceToken(baseUrl, currentToken, groupId)
                val broadcastTokenData = runCatching {
                    api.requestBroadcastVoiceToken(baseUrl, currentToken)
                }.getOrNull()
                voiceSession.connect(tokenData, userId, userName.ifBlank { "Mobile User" }, broadcastTokenData)
                // Pass a token provider (not a snapshot) so each floor request
                // reads the freshest access token from prefs — avoids silent 401
                // after a 14-min refresh.
                voiceSession.setRecordingParams(
                    baseUrl = baseUrl,
                    tokenProvider = { prefs.accessToken.ifBlank { accessToken } },
                    channelId = groupId,
                    channelName = groupName,
                )
                reconnectAttempt = 0 // reset on success
                startGps() // start GPS posting now that we're connected and have credentials
            } catch (e: PushcommUnauthorizedException) {
                // Access token expired — signal AppViewModel to refresh, then retry quickly
                immediateRefreshRequested.tryEmit(Unit)
                reconnectAttempt = 0  // reset backoff so next attempt fires in 2s, not 30s
                _voiceState.value = _voiceState.value.copy(connected = false, error = "Session expired, refreshing…")
                updateNotification("Refreshing session…", "")
                scheduleReconnect()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _voiceState.value = _voiceState.value.copy(
                    connected = false,
                    error = e.message ?: "Connection failed"
                )
                updateNotification("Connection failed", "")
                scheduleReconnect()
            }
        }
    }

    private fun scheduleReconnect() {
        if (reconnectJob?.isActive == true) return // already scheduled
        if (baseUrl.isBlank() || accessToken.isBlank() || groupId.isBlank()) return

        val delayMs = reconnectDelaysMs.getOrElse(reconnectAttempt) { 30_000L }
        reconnectAttempt++

        reconnectJob = serviceScope.launch {
            updateNotification("Reconnecting in ${delayMs / 1000}s...", "(attempt $reconnectAttempt)")
            delay(delayMs)
            reconnectJob = null
            // onAvailable() may have already established a good connection during the backoff
            // delay. Skip this reconnect to avoid tearing down a working room.
            if (_voiceState.value.connected) return@launch
            connectNow()
        }
    }

    private fun registerNetworkCallback() {
        unregisterNetworkCallback() // avoid double-registration
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                serviceScope.launch {
                    if (baseUrl.isBlank()) return@launch
                    val networkChanged = activeNetwork != null && network != activeNetwork
                    activeNetwork = network
                    if (networkChanged) {
                        // Network object changed (e.g. WiFi-A → WiFi-B, or WiFi → Cellular).
                        // Force reconnect unconditionally — whether the socket is still
                        // "connected" (stale) or already in backoff, skip the wait.
                        // Clear lastLinkAddresses so the first onLinkPropertiesChanged() on
                        // the new network doesn't see an IP "change" and double-fire.
                        lastLinkAddresses = emptySet()
                        connectJob?.cancel()
                        reconnectJob?.cancel()
                        reconnectJob = null
                        reconnectAttempt = 0
                        connectNow()
                    } else if (!_voiceState.value.connected && connectJob?.isActive != true) {
                        // Same network reappeared while disconnected — cancel backoff, try now.
                        reconnectJob?.cancel()
                        reconnectJob = null
                        reconnectAttempt = 0
                        connectNow()
                    }
                }
            }

            override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) {
                serviceScope.launch {
                    if (baseUrl.isBlank() || network != activeNetwork) return@launch
                    val currentAddresses = linkProperties.linkAddresses
                        .mapNotNull { it.address.hostAddress }
                        .toSet()
                    val ipChanged = lastLinkAddresses.isNotEmpty() && currentAddresses != lastLinkAddresses
                    lastLinkAddresses = currentAddresses
                    if (ipChanged) {
                        // IP changed on the same Network object — WiFi AP/SSID handover.
                        // Android doesn't always issue a new Network; detect via IP change.
                        connectJob?.cancel()
                        reconnectJob?.cancel()
                        reconnectJob = null
                        reconnectAttempt = 0
                        connectNow()
                    }
                }
            }
        }
        cm.registerNetworkCallback(request, cb)
        networkCallback = cb
    }

    private fun unregisterNetworkCallback() {
        networkCallback?.let {
            runCatching {
                (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
                    .unregisterNetworkCallback(it)
            }
        }
        networkCallback = null
        activeNetwork = null
        lastLinkAddresses = emptySet()
    }

    // ----------------------------------------------------------------
    //  Notification
    // ----------------------------------------------------------------

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "PushComm PTT",
            NotificationManager.IMPORTANCE_LOW, // LOW = no sound, shows in tray
        ).apply {
            description = "Keeps PTT voice connection alive in the background"
            setShowBadge(false)
        }
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(statusLine: String, detail: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val disconnectIntent = PendingIntent.getService(
            this, 1,
            Intent(this, PttForegroundService::class.java).apply { action = ACTION_DISCONNECT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("PushComm PTT")
            .setContentText(statusLine)
            .setSubText(detail.ifBlank { null })
            .setOngoing(true)
            .setContentIntent(openIntent)
            .addAction(
                Notification.Action.Builder(
                    null,
                    "Disconnect",
                    disconnectIntent,
                ).build()
            )
            .build()
    }

    private fun updateNotification(statusLine: String, detail: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(statusLine, detail))
    }

    private fun updateNotification(state: VoiceSessionManager.VoiceState) {
        val statusLine = when {
            state.talking -> "Transmitting..."
            state.connected -> "Connected${if (!state.roomName.isNullOrBlank()) " · ${state.roomName}" else ""}"
            !state.error.isNullOrBlank() -> "Error: ${state.error}"
            else -> "Disconnected"
        }
        val detail = buildString {
            if (state.participantCount > 0) append("${state.participantCount} participant${if (state.participantCount != 1) "s" else ""}")
            if (!state.floorHolderName.isNullOrBlank() && !state.talking) {
                if (isNotEmpty()) append(" · ")
                append("Speaking: ${state.floorHolderName}")
            }
        }
        updateNotification(statusLine, detail)
    }
}
