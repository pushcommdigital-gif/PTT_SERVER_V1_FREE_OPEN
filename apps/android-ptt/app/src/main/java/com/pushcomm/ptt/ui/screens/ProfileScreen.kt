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
package com.pushcomm.ptt.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import android.view.KeyEvent
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pushcomm.ptt.BuildConfig
import com.pushcomm.ptt.DeviceProfile
import com.pushcomm.ptt.ui.theme.ColorAccent
import com.pushcomm.ptt.ui.theme.ColorBackground
import com.pushcomm.ptt.ui.theme.ColorError
import com.pushcomm.ptt.ui.theme.ColorOnline
import com.pushcomm.ptt.ui.theme.ColorSurface
import com.pushcomm.ptt.ui.theme.ColorSurfaceHigh
import com.pushcomm.ptt.ui.theme.ColorTextSecondary
import com.pushcomm.ptt.viewmodel.AppViewModel

private data class StatusOption(
    val label: String,
    val state: String,
    val color: Color,
    val hexColor: String,
)

private val statuses = listOf(
    StatusOption("Available", "available", ColorOnline, "#22c55e"),
    StatusOption("En Route", "en_route", Color(0xFF38BDF8), "#38bdf8"),
    StatusOption("On Scene", "on_scene", Color(0xFFF59E0B), "#f59e0b"),
    StatusOption("Busy", "busy", Color(0xFFA855F7), "#a855f7"),
    StatusOption("Break", "break", Color(0xFF64748B), "#64748b"),
    StatusOption("Unavailable", "unavailable", Color(0xFFEF4444), "#ef4444"),
    StatusOption("Off Duty", "off_duty", ColorTextSecondary, "#64748b"),
    StatusOption("Emergency", "emergency", Color(0xFFDC2626), "#dc2626"),
)

private fun keycodeLabel(keycode: Int): String {
    if (keycode == -1) return "Not set"
    if (keycode <= -100_000) return "Scan code ${(-100_000 - keycode)}"
    val raw = KeyEvent.keyCodeToString(keycode) // e.g. "KEYCODE_VOLUME_DOWN"
    return raw.removePrefix("KEYCODE_").replace('_', ' ').lowercase()
        .replaceFirstChar { it.uppercaseChar() } // "Volume down"
}

@Composable
fun ProfileScreen(appVm: AppViewModel, onLogout: () -> Unit = { appVm.logout() }) {
    val session by appVm.session.collectAsState()
    val isCapturing by appVm.isCapturingPttKey.collectAsState()
    val hardwarePttKeycode by appVm.hardwarePttKeycode.collectAsState()
    val hardwarePttMode by appVm.hardwarePttMode.collectAsState()
    val userStatus by appVm.userStatus.collectAsState()
    var showLogoutDialog by remember { mutableStateOf(false) }

    if (showLogoutDialog) {
        LogoutPinDialog(
            appVm = appVm,
            onDismiss = { showLogoutDialog = false },
            onConfirm = { showLogoutDialog = false; onLogout() },
        )
    }

    Column(
        modifier = Modifier.fillMaxSize().background(ColorBackground),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Scrollable content — takes all space above the logout button
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 24.dp),
        ) {
            // Avatar
            val initial = session.userName.firstOrNull()?.uppercaseChar() ?: '?'
            Box(
                modifier = Modifier.size(96.dp).clip(CircleShape).background(ColorAccent),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = initial.toString(),
                    color = Color.White,
                    fontSize = 42.sp,
                    fontWeight = FontWeight.Bold,
                )
            }

            Spacer(Modifier.height(16.dp))

            Text(
                text = session.userName.ifBlank { "Unknown User" },
                color = Color.White,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )

            if (session.callsign.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "Callsign: @${session.callsign}",
                    color = ColorTextSecondary,
                    fontSize = 13.sp,
                )
            }

            Spacer(Modifier.height(4.dp))

            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(ColorAccent.copy(alpha = 0.2f))
                    .padding(horizontal = 12.dp, vertical = 4.dp),
            ) {
                Text(
                    text = if (session.loggedIn) "Online" else "Offline",
                    color = ColorAccent,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Device profile: ${DeviceProfile.displayName}",
                color = ColorTextSecondary,
                fontSize = 12.sp,
            )

            Spacer(Modifier.height(32.dp))
            HorizontalDivider(color = ColorSurfaceHigh)
            Spacer(Modifier.height(24.dp))

            // Status selector
            Text(
                text = "STATUS",
                color = ColorTextSecondary,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(ColorSurface),
            ) {
                statuses.forEachIndexed { idx, option ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier.size(10.dp).clip(CircleShape).background(option.color),
                        )
                        Text(
                            text = option.label,
                            color = Color.White,
                            fontSize = 15.sp,
                            modifier = Modifier.weight(1f).padding(start = 12.dp),
                        )
                        RadioButton(
                            selected = userStatus.state == option.state,
                            onClick = { appVm.setMyStatus(option.state, option.label, option.hexColor) },
                            colors = RadioButtonDefaults.colors(
                                selectedColor = ColorAccent,
                                unselectedColor = ColorTextSecondary,
                            ),
                        )
                    }
                    if (idx < statuses.size - 1) {
                        HorizontalDivider(color = ColorSurfaceHigh, modifier = Modifier.padding(horizontal = 16.dp))
                    }
                }
            }
            if (userStatus.saving || userStatus.error != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = userStatus.error ?: "Updating status...",
                    color = if (userStatus.error != null) ColorError else ColorTextSecondary,
                    fontSize = 12.sp,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(32.dp))
            HorizontalDivider(color = ColorSurfaceHigh)
            Spacer(Modifier.height(24.dp))

            // Server URL section
            Text(
                text = "SERVER",
                color = ColorTextSecondary,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))

            var serverUrl by remember(session.baseUrl) { mutableStateOf(session.baseUrl) }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(ColorSurface)
                    .padding(16.dp),
            ) {
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    label = { Text("Server URL") },
                    placeholder = { Text("http://your-server:3000") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedBorderColor = ColorAccent,
                        unfocusedBorderColor = ColorSurfaceHigh,
                        focusedLabelColor = ColorAccent,
                        unfocusedLabelColor = ColorTextSecondary,
                        cursorColor = ColorAccent,
                    ),
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { appVm.updateServerUrl(serverUrl) },
                    enabled = serverUrl.isNotBlank() && serverUrl != session.baseUrl,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = ColorAccent.copy(alpha = 0.15f)),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text(
                        "Save",
                        color = if (serverUrl.isNotBlank() && serverUrl != session.baseUrl) ColorAccent else ColorTextSecondary,
                        fontSize = 13.sp,
                    )
                }
            }

            Spacer(Modifier.height(32.dp))
            HorizontalDivider(color = ColorSurfaceHigh)
            Spacer(Modifier.height(24.dp))

            // Hardware PTT button section
            Text(
                text = "OPTIONAL HARDWARE PTT BUTTON",
                color = ColorTextSecondary,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(ColorSurface),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Assigned button", color = Color.White, fontSize = 15.sp)
                        Text(
                            keycodeLabel(hardwarePttKeycode),
                            color = if (hardwarePttKeycode != -1) ColorAccent else ColorTextSecondary,
                            fontSize = 13.sp,
                        )
                    }
                    Button(
                        onClick = { appVm.startPttCapture() },
                        colors = ButtonDefaults.buttonColors(containerColor = ColorAccent.copy(alpha = 0.15f)),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text("Change", color = ColorAccent, fontSize = 13.sp)
                    }
                }
                if (hardwarePttKeycode != -1) {
                    HorizontalDivider(color = ColorSurfaceHigh, modifier = Modifier.padding(horizontal = 16.dp))
                    TextButton(
                        onClick = { appVm.clearHardwarePttKey() },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                    ) {
                        Text("Remove hardware button", color = ColorTextSecondary, fontSize = 13.sp)
                    }
                }
                run {
                    HorizontalDivider(color = ColorSurfaceHigh, modifier = Modifier.padding(horizontal = 16.dp))
                    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Text("Button behavior", color = ColorTextSecondary, fontSize = 12.sp)
                        Spacer(Modifier.height(6.dp))
                        Row(modifier = Modifier.fillMaxWidth()) {
                            TextButton(
                                onClick = { appVm.setHardwarePttMode("hold") },
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(
                                    if (hardwarePttMode == "hold") "Hold selected" else "Hold",
                                    color = if (hardwarePttMode == "hold") ColorAccent else ColorTextSecondary,
                                    fontSize = 13.sp,
                                )
                            }
                            TextButton(
                                onClick = { appVm.setHardwarePttMode("toggle") },
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(
                                    if (hardwarePttMode == "toggle") "Toggle selected" else "Toggle",
                                    color = if (hardwarePttMode == "toggle") ColorAccent else ColorTextSecondary,
                                    fontSize = 13.sp,
                                )
                            }
                        }
                        Text(
                            if (hardwarePttMode == "toggle") "Press once to talk, press again to stop."
                            else "Transmit while the key is held down.",
                            color = ColorTextSecondary,
                            fontSize = 12.sp,
                        )
                    }
                }
                HorizontalDivider(color = ColorSurfaceHigh, modifier = Modifier.padding(horizontal = 16.dp))
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Text(
                        "Phones normally use the on-screen PTT button. Use capture only if this phone has a case, remote, or accessory button.",
                        color = ColorTextSecondary,
                        fontSize = 12.sp,
                    )
                }
            }
        }

        // Capture dialog — shown on top of everything while listening for a key press
        if (isCapturing) {
            AlertDialog(
                onDismissRequest = { appVm.cancelPttCapture() },
                title = { Text("Press any hardware button", color = Color.White, fontWeight = FontWeight.Bold) },
                text = {
                    Text(
                        "Press the physical button you want to use as your PTT key.\n\nYou can use volume keys, a side button, or any dedicated PTT key on your device.",
                        color = ColorTextSecondary,
                        fontSize = 14.sp,
                    )
                },
                confirmButton = {},
                dismissButton = {
                    TextButton(onClick = { appVm.cancelPttCapture() }) {
                        Text("Cancel", color = ColorTextSecondary)
                    }
                },
                containerColor = Color(0xFF242830),
            )
        }

        // Logout button — always pinned at the bottom
        HorizontalDivider(color = ColorSurfaceHigh)
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp)) {
            Button(
                onClick = { showLogoutDialog = true },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = ColorError.copy(alpha = 0.15f)),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Log Out", color = ColorError, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "${DeviceProfile.displayName} · v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                color = ColorTextSecondary,
                fontSize = 11.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/**
 * Logout requires the admin PIN — stops field operators from accidentally
 * signing themselves out (after which they'd be stuck at a username/password
 * screen). The PIN is a server-side department setting (changeable from the
 * dashboard); the entered value is verified by the server, never stored on the
 * device. Needs a connection (by design — logout is a deliberate admin action).
 */
@Composable
private fun LogoutPinDialog(appVm: AppViewModel, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    var pin by remember { mutableStateOf("") }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var verifying by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!verifying) onDismiss() },
        containerColor = Color(0xFF242830),
        title = { Text("Log out?", color = Color.White, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(
                    "You'll have to sign back in with a username and password. Enter the admin PIN to confirm.",
                    color = ColorTextSecondary,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = pin,
                    onValueChange = { v -> pin = v.filter { it.isDigit() }.take(8); errorMsg = null },
                    label = { Text("Admin PIN") },
                    singleLine = true,
                    enabled = !verifying,
                    isError = errorMsg != null,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = ColorAccent,
                        unfocusedBorderColor = ColorSurfaceHigh,
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        cursorColor = ColorAccent,
                    ),
                )
                if (errorMsg != null) {
                    Spacer(Modifier.height(6.dp))
                    Text(errorMsg!!, color = ColorError, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !verifying && pin.isNotBlank(),
                onClick = {
                    verifying = true
                    errorMsg = null
                    appVm.verifyAdminPin(pin) { result ->
                        verifying = false
                        when (result) {
                            AppViewModel.PinVerifyResult.VALID -> onConfirm()
                            AppViewModel.PinVerifyResult.INVALID -> errorMsg = "Incorrect PIN"
                            AppViewModel.PinVerifyResult.ERROR -> errorMsg = "Couldn't verify — check your connection"
                        }
                    }
                },
            ) {
                Text(if (verifying) "Checking…" else "Log Out", color = ColorError, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !verifying) { Text("Cancel", color = ColorTextSecondary) }
        },
    )
}
