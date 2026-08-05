package com.pushcomm.ptt

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.text.input.ImeAction
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.pushcomm.ptt.ui.screens.ChatScreen
import com.pushcomm.ptt.ui.screens.MapScreen
import com.pushcomm.ptt.ui.screens.MessagesListScreen
import com.pushcomm.ptt.ui.screens.PrivateCallScreen
import com.pushcomm.ptt.ui.screens.ProfileScreen
import com.pushcomm.ptt.ui.screens.PttScreen
import com.pushcomm.ptt.ui.theme.ColorAccent
import com.pushcomm.ptt.ui.theme.ColorBackground
import com.pushcomm.ptt.ui.theme.ColorError
import com.pushcomm.ptt.ui.theme.ColorSurface
import com.pushcomm.ptt.ui.theme.ColorSurfaceHigh
import com.pushcomm.ptt.ui.theme.ColorTextSecondary
import com.pushcomm.ptt.ui.theme.PushcommTheme
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import kotlinx.coroutines.delay
import com.pushcomm.ptt.viewmodel.AppViewModel
import com.pushcomm.ptt.viewmodel.MapViewModel
import com.pushcomm.ptt.viewmodel.MessagesViewModel
import com.pushcomm.ptt.viewmodel.PrivateCallViewModel
import com.pushcomm.ptt.viewmodel.PttViewModel
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class MainActivity : ComponentActivity() {
    companion object {
        // PTT broadcast handling lives in PttForegroundService so that a paired
        // hardware button keeps working when this Activity is paused (screen
        // off, app backgrounded). See PttForegroundService.PTT_DOWN_ACTIONS.
    }

    private val appVm: AppViewModel by viewModels()
    private val pttVm: PttViewModel by viewModels()
    private val messagesVm: MessagesViewModel by viewModels()
    private val mapVm: MapViewModel by viewModels()
    private val privateCallVm: PrivateCallViewModel by viewModels()
    private var hardwarePttLatched = false

    // ---- Permission launchers ----

    private val requestMicPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* PttButton checks inline */ }

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* proceed regardless */ }

    private val requestLocationPermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { /* MapViewModel re-checks on startTracking */ }

    // ---- Lifecycle ----

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        ensurePermissions()

        setContent {
            PushcommTheme {
                AppRoot(appVm, pttVm, messagesVm, mapVm, privateCallVm)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        pttVm.bindService()
    }

    override fun onStop() {
        super.onStop()
        pttVm.unbindService()
    }

    // ---- Hardware PTT key (side scroll/PTT button on radio handsets) ----

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Exclude navigation keys from both capture and PTT.
        if (event.keyCode == KeyEvent.KEYCODE_BACK || event.keyCode == KeyEvent.KEYCODE_HOME) {
            return super.dispatchKeyEvent(event)
        }

        val hardwareKeyId = encodeHardwareKey(event)
        if (hardwareKeyId == KeyEvent.KEYCODE_UNKNOWN) {
            return super.dispatchKeyEvent(event)
        }

        // Capture before Compose/dialog focus can consume the key event.
        if (appVm.isCapturingPttKey.value) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                appVm.onHardwareKeySelected(hardwareKeyId)
            }
            return true
        }

        val savedKey = appVm.hardwarePttKeycode.value
        if (savedKey != -1 && hardwareKeyId == savedKey && appVm.session.value.loggedIn) {
            run {
                when (event.action) {
                    KeyEvent.ACTION_DOWN -> {
                        if (event.repeatCount == 0) {
                            handleHardwarePttDown()
                        }
                        return true
                    }
                    KeyEvent.ACTION_UP -> {
                        handleHardwarePttUp()
                        return true
                    }
                }
            }
        }

        return super.dispatchKeyEvent(event)
    }

    private fun encodeHardwareKey(event: KeyEvent): Int {
        if (event.keyCode != KeyEvent.KEYCODE_UNKNOWN) return event.keyCode
        return if (event.scanCode > 0) -100_000 - event.scanCode else KeyEvent.KEYCODE_UNKNOWN
    }

    private fun handleHardwarePttDown() {
        if (!appVm.session.value.loggedIn) return
        if (appVm.hardwarePttMode.value == "toggle") {
            if (hardwarePttLatched) stopHardwarePtt() else startHardwarePtt()
        } else {
            startHardwarePtt()
        }
    }

    private fun handleHardwarePttUp() {
        if (!appVm.session.value.loggedIn) return
        if (appVm.hardwarePttMode.value != "toggle") stopHardwarePtt()
    }

    private fun startHardwarePtt() {
        if (hardwarePttLatched) return  // debounce duplicate signals
        hardwarePttLatched = true
        if (privateCallVm.state.value.isActive) privateCallVm.startTalking()
        else pttVm.startTalking()
    }

    private fun stopHardwarePtt() {
        if (!hardwarePttLatched) return
        hardwarePttLatched = false
        if (privateCallVm.state.value.isActive) privateCallVm.stopTalking()
        else pttVm.stopTalking()
    }

    // ---- Permissions ----

    private fun ensurePermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            requestMicPermission.launch(Manifest.permission.RECORD_AUDIO)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        val locationGranted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (!locationGranted) {
            requestLocationPermissions.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
            )
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
//  Root composable — decides between Login and Main
// ────────────────────────────────────────────────────────────────────────────

@Composable
private fun AppRoot(
    appVm: AppViewModel,
    pttVm: PttViewModel,
    messagesVm: MessagesViewModel,
    mapVm: MapViewModel,
    privateCallVm: PrivateCallViewModel,
) {
    val session by appVm.session.collectAsState()

    Box(
        modifier = Modifier.fillMaxSize().background(ColorBackground),
    ) {
        when {
            session.loading && !session.loggedIn -> {
                // Cold start: checking saved session
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = ColorAccent)
                }
            }
            !session.loggedIn -> {
                LoginScreen(appVm)
            }
            else -> {
                MainScreen(appVm, pttVm, messagesVm, mapVm, privateCallVm)
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
//  Login screen
// ────────────────────────────────────────────────────────────────────────────

private const val DEFAULT_SERVER_URL = "https://api.pushcomm.cloud"

private fun normalizeServerUrl(input: String): String {
    val clean = input.trim().trimEnd('/')
    if (clean.isBlank()) return DEFAULT_SERVER_URL
    return if (clean.startsWith("http://") || clean.startsWith("https://")) clean else "https://$clean"
}

@Composable
private fun LoginScreen(appVm: AppViewModel) {
    val session by appVm.session.collectAsState()

    var baseUrl by remember { mutableStateOf(appVm.savedBaseUrl().ifBlank { DEFAULT_SERVER_URL }) }
    var username by remember { mutableStateOf(appVm.savedUsername()) }
    var password by remember { mutableStateOf("") }
    var provisioningCode by remember { mutableStateOf("") }

    val qrLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { appVm.provisionFromQr(it) }
    }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = ColorAccent,
        unfocusedBorderColor = ColorSurfaceHigh,
        focusedLabelColor = ColorAccent,
        unfocusedLabelColor = ColorTextSecondary,
        cursorColor = ColorAccent,
        focusedTextColor = Color.White,
        unfocusedTextColor = Color.White,
        focusedContainerColor = ColorSurface,
        unfocusedContainerColor = ColorSurface,
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ColorBackground)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // Logo / badge
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(CircleShape)
                .background(ColorAccent),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Default.Mic,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(40.dp),
            )
        }

        Spacer(Modifier.height(24.dp))

        Text(
            text = "PushComm",
            color = Color.White,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "PTT Dispatch Platform",
            color = ColorTextSecondary,
            fontSize = 14.sp,
        )

        Spacer(Modifier.height(40.dp))

        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = { Text("Server URL") },
            placeholder = { Text(DEFAULT_SERVER_URL) },
            modifier = Modifier.fillMaxWidth(),
            colors = fieldColors,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            shape = RoundedCornerShape(12.dp),
        )

        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("Username or Email") },
            modifier = Modifier.fillMaxWidth(),
            colors = fieldColors,
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
        )

        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            modifier = Modifier.fillMaxWidth(),
            colors = fieldColors,
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            shape = RoundedCornerShape(12.dp),
        )

        if (session.error != null) {
            Spacer(Modifier.height(12.dp))
            Text(
                text = session.error ?: "",
                color = ColorError,
                fontSize = 13.sp,
            )
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = { appVm.login(normalizeServerUrl(baseUrl), username, password) },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            enabled = !session.loading && baseUrl.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = ColorAccent),
            shape = RoundedCornerShape(12.dp),
        ) {
            if (session.loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Color.White,
                    strokeWidth = 2.dp,
                )
            } else {
                Text(
                    "Sign In",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
            }
        }

        Spacer(Modifier.height(20.dp))

        Text(
            text = "or provision this device",
            color = ColorTextSecondary,
            fontSize = 12.sp,
        )

        Spacer(Modifier.height(12.dp))

        run {
            Button(
                onClick = {
                    val options = ScanOptions()
                        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                        .setPrompt("Scan PushComm provisioning QR")
                        .setBeepEnabled(true)
                        .setOrientationLocked(false)
                    qrLauncher.launch(options)
                },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                enabled = !session.loading,
                colors = ButtonDefaults.buttonColors(containerColor = ColorSurfaceHigh),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Scan Provisioning QR", color = Color.White, fontWeight = FontWeight.Bold)
            }

            Spacer(Modifier.height(12.dp))
        }

        val submitProvision = {
            if (!session.loading && provisioningCode.isNotBlank()) {
                appVm.provisionWithCode(normalizeServerUrl(baseUrl), provisioningCode)
            }
        }

        OutlinedTextField(
            value = provisioningCode,
            onValueChange = { provisioningCode = it.trim() },
            label = { Text("Manual Provisioning Code") },
            modifier = Modifier.fillMaxWidth(),
            colors = fieldColors,
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submitProvision() }),
        )

        Spacer(Modifier.height(12.dp))

        // Promoted from TextButton → real styled Button. On 2.4" screens
        // (N58) the TextButton variant was effectively invisible at the
        // bottom of a long scrolling form behind the soft keyboard.
        Button(
            onClick = { submitProvision() },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            enabled = !session.loading && provisioningCode.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = ColorAccent),
            shape = RoundedCornerShape(12.dp),
        ) {
            if (session.loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Color.White,
                    strokeWidth = 2.dp,
                )
            } else {
                Text("Activate Device", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}

// ────────────────────────────────────────────────────────────────────────────
//  Main screen — bottom NavigationBar with 4 tabs
// ────────────────────────────────────────────────────────────────────────────

private enum class AppTab { PTT, MESSAGES, MAP, PROFILE }

@OptIn(ExperimentalPermissionsApi::class)
@Composable
private fun MainScreen(
    appVm: AppViewModel,
    pttVm: PttViewModel,
    messagesVm: MessagesViewModel,
    mapVm: MapViewModel,
    privateCallVm: PrivateCallViewModel,
) {
    val session by appVm.session.collectAsState()
    val messagesState by messagesVm.state.collectAsState()
    val unreadCount by appVm.unreadCount.collectAsState()
    val privateCallState by privateCallVm.state.collectAsState()
    val activeSosId by appVm.activeSosId.collectAsState()
    val sosUiState by appVm.sosUiState.collectAsState()
    val loneWorkerRemaining by appVm.loneWorkerRemaining.collectAsState()

    var selectedTab by remember { mutableStateOf(AppTab.PTT) }

    // Lone Worker dialog state — SOS itself is triggered by the on-screen
    // dedicated hardware button (KEY_F3, hold 1.5s). The touchscreen bar only
    // opens the Lone Worker dialog and shows status (SOS active, LW countdown).
    var showLoneWorkerDialog by remember { mutableStateOf(false) }
    var showEmergencyControlsDialog by remember { mutableStateOf(false) }
    var loneWorkerInput by remember { mutableStateOf("10") }

    LaunchedEffect(sosUiState.message, sosUiState.error) {
        if (sosUiState.message != null || sosUiState.error != null) {
            delay(3500)
            appVm.clearSosFeedback()
        }
    }

    // When the app wakes from a killed state via FCM call notification, pick up the stored call
    LaunchedEffect(session.loggedIn) {
        if (session.loggedIn) appVm.checkPendingCall()
    }

    // Incoming private call (walkie-talkie: auto-join immediately)
    LaunchedEffect(Unit) {
        appVm.privateCallIncoming.collect { event ->
            if (session.loggedIn && !privateCallState.isActive) {
                privateCallVm.joinIncoming(
                    baseUrl = session.baseUrl,
                    token = session.accessToken,
                    initiatorId = event.initiatorId,
                    initiatorName = event.initiatorName,
                    roomName = event.roomName,
                    userId = session.userId,
                    userName = session.userName,
                )
            }
        }
    }

    LaunchedEffect(Unit) {
        appVm.privateCallEnded.collect {
            privateCallVm.remoteEnded()
        }
    }

    // ── Visual Verification: dispatcher media request + self-initiated report ──
    // GPS posting — runs whenever logged in + location permission granted, on any tab
    val locationPermissions = rememberMultiplePermissionsState(
        permissions = listOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ),
    )

    LaunchedEffect(session.loggedIn, locationPermissions.allPermissionsGranted) {
        if (session.loggedIn && !locationPermissions.allPermissionsGranted) {
            locationPermissions.launchMultiplePermissionRequest()
        }
    }

    DisposableEffect(session.loggedIn, locationPermissions.allPermissionsGranted, session.baseUrl, session.accessToken) {
        if (session.loggedIn && locationPermissions.allPermissionsGranted) {
            // MapViewModel: one-shot getCurrentLocation for immediate map display
            mapVm.startGps(session.baseUrl, session.accessToken)
            // PttForegroundService: continuous HandlerThread GPS — survives Doze/screen-off
            pttVm.startGps()
        }
        onDispose {
            mapVm.stopGps()
        }
    }

    // Map overview refresh — only while the Map tab is visible
    DisposableEffect(selectedTab, session.loggedIn) {
        if (selectedTab == AppTab.MAP && session.loggedIn) {
            mapVm.startMapRefresh(session.baseUrl, session.accessToken)
        }
        onDispose {
            if (selectedTab == AppTab.MAP) mapVm.stopMapRefresh()
        }
    }

    // Auto-connect PTT to last-used group once after login.
    // This promotes the service to foreground so it survives app backgrounding.
    val pttAutoConnected = remember { mutableStateOf(false) }
    LaunchedEffect(session.loggedIn, session.groups.size) {
        Log.i("PttAutoConnect", "fired: loggedIn=${session.loggedIn} groups=${session.groups.size} alreadyConnected=${pttAutoConnected.value} voiceConnected=${pttVm.voiceState.value.connected}")
        if (!session.loggedIn || session.groups.isEmpty() || pttAutoConnected.value) {
            Log.i("PttAutoConnect", "  → skip (precondition not met)")
            return@LaunchedEffect
        }
        if (pttVm.voiceState.value.connected) {
            Log.i("PttAutoConnect", "  → already voice-connected; marking flag and skipping")
            pttAutoConnected.value = true
            return@LaunchedEffect
        }
        val savedId = appVm.savedGroupId()
        val group = session.groups.firstOrNull { it.id == savedId } ?: session.groups.first()
        Log.i("PttAutoConnect", "  → connecting to group=${group.name} (id=${group.id}, savedId='$savedId')")
        pttAutoConnected.value = true
        pttVm.connectGroup(
            baseUrl = session.baseUrl,
            accessToken = session.accessToken,
            groupId = group.id,
            groupName = group.name,
            userId = session.userId,
            userName = session.userName,
        )
    }

    // Propagate refreshed access token to the PTT foreground service so reconnects succeed
    LaunchedEffect(session.accessToken) {
        if (session.accessToken.isNotBlank()) {
            pttVm.updateToken(session.accessToken)
        }
    }

    // Load conversations when switching to Messages tab
    LaunchedEffect(selectedTab, session.loggedIn) {
        if (selectedTab == AppTab.MESSAGES && session.loggedIn) {
            messagesVm.loadConversations(session.baseUrl, session.accessToken)
        }
    }

    // Private call screen covers the entire UI when a 1:1 call is active
    if (privateCallState.isActive) {
        BackHandler {
            privateCallVm.hangUp(session.baseUrl, session.accessToken)
        }
        PrivateCallScreen(
            privateCallVm = privateCallVm,
            pttVm = pttVm,
            onEnd = { /* screen clears via state change */ },
            baseUrl = session.baseUrl,
            token = session.accessToken,
        )
        return
    }

    // ── Lone Worker dialog ────────────────────────────────────────────────────
    if (showEmergencyControlsDialog) {
        AlertDialog(
            onDismissRequest = { showEmergencyControlsDialog = false },
            containerColor = ColorSurface,
            title = {
                Text("Emergency Controls", color = Color.White, fontWeight = FontWeight.Bold)
            },
            text = {
                Column {
                    if (activeSosId != null) {
                        Text(
                            "SOS is active. If this was a mistake or the emergency is resolved, cancel it here.",
                            color = ColorTextSecondary,
                            fontSize = 13.sp,
                        )
                    }
                    if (loneWorkerRemaining != null) {
                        val m = loneWorkerRemaining!! / 60
                        val s = (loneWorkerRemaining!! % 60).toString().padStart(2, '0')
                        Spacer(Modifier.height(if (activeSosId != null) 12.dp else 0.dp))
                        Text(
                            "Lone Worker timer: $m:$s remaining",
                            color = ColorAccent,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                        )
                    }
                    if (activeSosId == null && loneWorkerRemaining == null) {
                        Text("No active emergency state.", color = ColorTextSecondary, fontSize = 13.sp)
                    }
                }
            },
            confirmButton = {
                if (activeSosId != null) {
                    Button(
                        onClick = {
                            appVm.cancelSos()
                            showEmergencyControlsDialog = false
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = ColorError),
                    ) {
                        Text("Cancel SOS")
                    }
                } else if (loneWorkerRemaining != null) {
                    Button(
                        onClick = {
                            val minutes = loneWorkerInput.toIntOrNull()?.coerceIn(1, 999) ?: 10
                            appVm.startLoneWorker(minutes)
                            showEmergencyControlsDialog = false
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = ColorAccent),
                    ) {
                        Text("Check In")
                    }
                }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (loneWorkerRemaining != null) {
                        TextButton(
                            onClick = {
                                appVm.cancelLoneWorker()
                                showEmergencyControlsDialog = false
                            },
                        ) {
                            Text("Stop Lone Worker", color = ColorError)
                        }
                    }
                    TextButton(onClick = { showEmergencyControlsDialog = false }) {
                        Text("Close", color = ColorTextSecondary)
                    }
                }
            },
        )
    }

    if (showLoneWorkerDialog) {
        AlertDialog(
            onDismissRequest = { showLoneWorkerDialog = false },
            containerColor = ColorSurface,
            title = {
                Text("Lone Worker / Man Down", color = Color.White, fontWeight = FontWeight.Bold)
            },
            text = {
                Column {
                    if (loneWorkerRemaining != null) {
                        val m = loneWorkerRemaining!! / 60
                        val s = (loneWorkerRemaining!! % 60).toString().padStart(2, '0')
                        Text(
                            "Timer active: $m:$s remaining",
                            color = ColorAccent,
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Tap 'Check In' to reset the timer. If time runs out, an SOS alert will be sent automatically.",
                            color = ColorTextSecondary,
                            fontSize = 13.sp,
                        )
                    } else {
                        Text(
                            "Set a check-in timer. If you don't check in before it expires, an SOS will be sent automatically.",
                            color = ColorTextSecondary,
                            fontSize = 13.sp,
                        )
                        Spacer(Modifier.height(16.dp))
                        OutlinedTextField(
                            value = loneWorkerInput,
                            onValueChange = { v ->
                                if (v.all { it.isDigit() } && v.length <= 3) loneWorkerInput = v
                            },
                            label = { Text("Minutes (1–999)", color = ColorTextSecondary) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = ColorAccent,
                                unfocusedBorderColor = ColorSurfaceHigh,
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                            ),
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val minutes = loneWorkerInput.toIntOrNull()?.coerceIn(1, 999) ?: 10
                        appVm.startLoneWorker(minutes)
                        showLoneWorkerDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = ColorAccent),
                ) {
                    Text(if (loneWorkerRemaining != null) "Check In (Reset)" else "Start Timer")
                }
            },
            dismissButton = {
                if (loneWorkerRemaining != null) {
                    TextButton(onClick = { appVm.cancelLoneWorker(); showLoneWorkerDialog = false }) {
                        Text("Stop Timer", color = ColorError)
                    }
                } else {
                    TextButton(onClick = { showLoneWorkerDialog = false }) {
                        Text("Cancel", color = ColorTextSecondary)
                    }
                }
            },
        )
    }

    Scaffold(
        containerColor = ColorBackground,
        bottomBar = {
            Column {
                if (selectedTab == AppTab.PTT) {
                    // Lone Worker / status bar.
                    // Tap → open Lone Worker dialog (or emergency controls if SOS / LW already active).
                    // SOS is fired from the on-screen control (or a paired hardware key).
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(
                                    when {
                                        sosUiState.loading -> ColorSurfaceHigh
                                        activeSosId != null -> ColorError
                                        loneWorkerRemaining != null -> ColorAccent.copy(alpha = 0.85f)
                                        else -> ColorAccent.copy(alpha = 0.25f)
                                    }
                                )
                                .pointerInput(sosUiState.loading) {
                                    detectTapGestures(
                                        onTap = {
                                            if (sosUiState.loading) return@detectTapGestures
                                            if (activeSosId != null || loneWorkerRemaining != null) {
                                                showEmergencyControlsDialog = true
                                            } else {
                                                showLoneWorkerDialog = true
                                            }
                                        }
                                    )
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Warning, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(8.dp))
                                val label = when {
                                    sosUiState.loading -> "SOS request in progress…"
                                    activeSosId != null -> "SOS ACTIVE · Tap controls"
                                    loneWorkerRemaining != null -> {
                                        val m = loneWorkerRemaining!! / 60
                                        val s = (loneWorkerRemaining!! % 60).toString().padStart(2, '0')
                                        "Lone Worker: $m:$s · Tap controls"
                                    }
                                    else -> "Tap for Lone Worker"
                                }
                                Text(label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            }
                        }
                        val sosFeedback = sosUiState.error ?: sosUiState.message
                        if (sosFeedback != null) {
                            Text(
                                text = sosFeedback,
                                color = if (sosUiState.error != null) ColorError else ColorAccent,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                    }
                }
            NavigationBar(
                containerColor = ColorSurface,
                tonalElevation = 0.dp,
            ) {
                val itemColors = NavigationBarItemDefaults.colors(
                    selectedIconColor = ColorAccent,
                    selectedTextColor = ColorAccent,
                    unselectedIconColor = ColorTextSecondary,
                    unselectedTextColor = ColorTextSecondary,
                    indicatorColor = ColorAccent.copy(alpha = 0.15f),
                )

                NavigationBarItem(
                    selected = selectedTab == AppTab.PTT,
                    onClick = { selectedTab = AppTab.PTT },
                    icon = { Icon(Icons.Default.Mic, contentDescription = "Radio") },
                    label = { Text("Radio") },
                    colors = itemColors,
                )
                NavigationBarItem(
                    selected = selectedTab == AppTab.MESSAGES,
                    onClick = {
                        selectedTab = AppTab.MESSAGES
                        appVm.clearUnreadCount()
                    },
                    icon = {
                        BadgedBox(badge = {
                            if (unreadCount > 0) Badge { Text(if (unreadCount > 99) "99+" else "$unreadCount") }
                        }) {
                            Icon(Icons.AutoMirrored.Filled.Message, contentDescription = "Messages")
                        }
                    },
                    label = { Text("Messages") },
                    colors = itemColors,
                )
                NavigationBarItem(
                    selected = selectedTab == AppTab.MAP,
                    onClick = { selectedTab = AppTab.MAP },
                    icon = { Icon(Icons.Default.LocationOn, contentDescription = "Map") },
                    label = { Text("Map") },
                    colors = itemColors,
                )
                NavigationBarItem(
                    selected = selectedTab == AppTab.PROFILE,
                    onClick = { selectedTab = AppTab.PROFILE },
                    icon = { Icon(Icons.Default.Person, contentDescription = "Profile") },
                    label = { Text("Profile") },
                    colors = itemColors,
                )
            }
            } // end Column
        },
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            when (selectedTab) {
                AppTab.PTT -> PttScreen(appVm = appVm, pttVm = pttVm, privateCallVm = privateCallVm)

                AppTab.MESSAGES -> {
                    // Back from chat → list
                    if (messagesState.activeTarget != null) {
                        BackHandler {
                            messagesVm.clearActiveTarget()
                            messagesVm.loadConversations(session.baseUrl, session.accessToken)
                        }
                        ChatScreen(
                            target = messagesState.activeTarget!!,
                            appVm = appVm,
                            messagesVm = messagesVm,
                            onBack = {
                                messagesVm.clearActiveTarget()
                                messagesVm.loadConversations(session.baseUrl, session.accessToken)
                            },
                            onViewLocation = { lat, lon ->
                                selectedTab = AppTab.MAP
                                mapVm.centerOn(lat, lon)
                            },
                        )
                    } else {
                        MessagesListScreen(
                            appVm = appVm,
                            messagesVm = messagesVm,
                            onOpenChat = { target ->
                                appVm.clearUnreadCount()
                                messagesVm.openChat(session.baseUrl, session.accessToken, target)
                            },
                            onCall = { targetUserId, targetName ->
                                privateCallVm.startCall(
                                    baseUrl = session.baseUrl,
                                    token = session.accessToken,
                                    targetUserId = targetUserId,
                                    targetName = targetName,
                                    userId = session.userId,
                                    userName = session.userName,
                                )
                            },
                        )
                    }
                }

                AppTab.MAP -> MapScreen(appVm = appVm, mapVm = mapVm)

                AppTab.PROFILE -> ProfileScreen(
                    appVm = appVm,
                    onLogout = {
                        privateCallVm.disconnectLocal()
                        pttVm.disconnectAndStop()
                        mapVm.stopGps()
                        mapVm.stopMapRefresh()
                        appVm.logout()
                    },
                )
            }
        }
    }
}
