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
package com.pushcomm.ptt.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pushcomm.ptt.DeviceProfile
import com.pushcomm.ptt.GroupItem
import com.pushcomm.ptt.ui.components.PttButton
import com.pushcomm.ptt.ui.components.PttButtonState
import com.pushcomm.ptt.ui.theme.ColorAccent
import com.pushcomm.ptt.ui.theme.ColorBackground
import com.pushcomm.ptt.ui.theme.ColorError
import com.pushcomm.ptt.ui.theme.ColorOnline
import com.pushcomm.ptt.ui.theme.ColorSurface
import com.pushcomm.ptt.ui.theme.ColorSurfaceHigh
import com.pushcomm.ptt.ui.theme.ColorTextSecondary
import com.pushcomm.ptt.viewmodel.AppViewModel
import com.pushcomm.ptt.viewmodel.PrivateCallViewModel
import com.pushcomm.ptt.viewmodel.PttViewModel

private enum class PttSection { GROUPS, USERS }

@Composable
fun PttScreen(appVm: AppViewModel, pttVm: PttViewModel, privateCallVm: PrivateCallViewModel) {
    val session by appVm.session.collectAsState()
    val voiceState by pttVm.voiceState.collectAsState()
    val privateCallState by privateCallVm.state.collectAsState()

    // Only one section open at a time; null = both collapsed
    var expandedSection by remember { mutableStateOf<PttSection?>(null) }
    var selectedGroup by remember { mutableStateOf<GroupItem?>(null) }
    var isTalking by remember { mutableStateOf(false) }
    val activeSosId by appVm.activeSosId.collectAsState()

    // If the mic fails to publish, the session manager reports talking=false + an
    // error (instead of a silent fake transmit). Collapse the optimistic "TX" UI.
    LaunchedEffect(voiceState.talking, voiceState.error) {
        if (isTalking && !voiceState.talking && voiceState.error != null) {
            isTalking = false
        }
    }

    // Auto-select last used group
    LaunchedEffect(session.groups) {
        if (session.groups.isNotEmpty() && selectedGroup == null) {
            val savedId = appVm.savedGroupId()
            selectedGroup = session.groups.firstOrNull { it.id == savedId }
                ?: session.groups.first()
        }
    }

    // SOS animation
    val infiniteTransition = rememberInfiniteTransition(label = "sos")
    val sosAlpha by infiniteTransition.animateFloat(
        initialValue = 0.4f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(500, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "sos_alpha",
    )

    val screenBg = if (activeSosId != null) ColorError.copy(alpha = sosAlpha * 0.3f) else ColorBackground
    val isSmartphoneProfile = DeviceProfile.isSmartphone
    val horizontalPadding = if (isSmartphoneProfile) 28.dp else 24.dp
    val pttButtonSize = if (isSmartphoneProfile) 230.dp else 200.dp
    val pttState = when {
        activeSosId != null -> PttButtonState.SOS
        isTalking           -> PttButtonState.TALKING
        else                -> PttButtonState.IDLE
    }
    val remoteSpeakerName = voiceState.floorHolderName
        ?.takeIf { it.isNotBlank() && !voiceState.talking && !isTalking }
    val pttButtonLabel = if (remoteSpeakerName != null) {
        "SPEAKING\n$remoteSpeakerName"
    } else {
        null
    }

    Box(modifier = Modifier.fillMaxSize().background(screenBg)) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxSize().padding(horizontal = horizontalPadding),
        ) {
            Spacer(Modifier.height(16.dp))

            if (isSmartphoneProfile) {
                Text(
                    text = "PushComm Radio",
                    color = Color.White,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "Touch-first smartphone profile",
                    color = ColorTextSecondary,
                    fontSize = 13.sp,
                )
                Spacer(Modifier.height(16.dp))
            }

            // ── Groups accordion ─────────────────────────────────────────────
            val groupsExpanded = expandedSection == PttSection.GROUPS

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(ColorSurface)
                    .clickable { expandedSection = if (groupsExpanded) null else PttSection.GROUPS }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Groups",
                    color = Color.White,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.width(8.dp))
                // Show connected group name when collapsed
                if (!groupsExpanded && voiceState.connected && selectedGroup != null) {
                    Text(
                        text = "· ${selectedGroup!!.name}",
                        color = ColorOnline,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    Spacer(Modifier.weight(1f))
                }
                Icon(
                    imageVector = if (groupsExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = null,
                    tint = ColorTextSecondary,
                    modifier = Modifier.size(20.dp),
                )
            }

            AnimatedVisibility(visible = groupsExpanded) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(bottomStart = 10.dp, bottomEnd = 10.dp))
                        .background(ColorSurface),
                ) {
                    if (session.groups.isEmpty()) {
                        Box(
                            modifier = Modifier.fillMaxWidth().height(72.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("No groups found", color = ColorTextSecondary, fontSize = 14.sp)
                        }
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp)) {
                            items(session.groups) { group ->
                                val isConnected = group.id == selectedGroup?.id && voiceState.connected
                                val initial = group.name.firstOrNull()?.uppercaseChar() ?: '?'

                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .background(if (isConnected) ColorAccent.copy(alpha = 0.08f) else Color.Transparent)
                                        .clickable(enabled = !isConnected && session.loggedIn) {
                                            selectedGroup = group
                                            appVm.saveSelectedGroup(group.id)
                                            pttVm.connectGroup(
                                                baseUrl = session.baseUrl,
                                                accessToken = session.accessToken,
                                                groupId = group.id,
                                                groupName = group.name,
                                                userId = session.userId,
                                                userName = session.userName,
                                            )
                                            expandedSection = null
                                        }
                                        .padding(horizontal = 16.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(36.dp)
                                            .clip(CircleShape)
                                            .background(if (isConnected) ColorAccent else ColorSurfaceHigh),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(initial.toString(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = group.name,
                                            color = Color.White,
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        if (isConnected) {
                                            Text("● ${voiceState.participantCount} online", color = ColorOnline, fontSize = 11.sp)
                                        }
                                    }
                                    if (isConnected) {
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(ColorOnline.copy(alpha = 0.15f))
                                                .padding(horizontal = 8.dp, vertical = 3.dp),
                                        ) {
                                            Text("Connected", color = ColorOnline, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                        }
                                    } else {
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(if (session.loggedIn) ColorAccent.copy(alpha = 0.15f) else ColorSurfaceHigh)
                                                .padding(horizontal = 8.dp, vertical = 3.dp),
                                        ) {
                                            Text(
                                                "Connect",
                                                color = if (session.loggedIn) ColorAccent else ColorTextSecondary,
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Bold,
                                            )
                                        }
                                    }
                                }
                                HorizontalDivider(color = ColorSurfaceHigh, thickness = 0.5.dp)
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            // ── Users accordion ──────────────────────────────────────────────
            val usersExpanded = expandedSection == PttSection.USERS
            val otherUsers = session.users.filter { it.id != session.userId }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(ColorSurface)
                    .clickable { expandedSection = if (usersExpanded) null else PttSection.USERS }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Users",
                    color = Color.White,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    imageVector = if (usersExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = null,
                    tint = ColorTextSecondary,
                    modifier = Modifier.size(20.dp),
                )
            }

            AnimatedVisibility(visible = usersExpanded) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(bottomStart = 10.dp, bottomEnd = 10.dp))
                        .background(ColorSurface),
                ) {
                    if (otherUsers.isEmpty()) {
                        Box(
                            modifier = Modifier.fillMaxWidth().height(72.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("No users found", color = ColorTextSecondary, fontSize = 14.sp)
                        }
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp)) {
                            items(otherUsers) { user ->
                                val fullName = "${user.firstName} ${user.lastName}".trim().ifBlank { user.username }
                                val initial = fullName.firstOrNull()?.uppercaseChar() ?: '?'
                                val startPrivateCall = {
                                    privateCallVm.startCall(
                                        baseUrl = session.baseUrl,
                                        token = session.accessToken,
                                        targetUserId = user.id,
                                        targetName = fullName,
                                        userId = session.userId,
                                        userName = session.userName,
                                    )
                                    expandedSection = null
                                }

                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable(onClick = startPrivateCall)
                                        .padding(horizontal = 16.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(36.dp)
                                            .clip(CircleShape)
                                            .background(Color(0xFF2980B9)),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(initial.toString(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Text(
                                        text = fullName,
                                        color = Color.White,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.weight(1f),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    IconButton(
                                        onClick = startPrivateCall,
                                        modifier = Modifier.size(36.dp),
                                    ) {
                                        Icon(Icons.Default.Phone, contentDescription = "Call $fullName", tint = ColorAccent, modifier = Modifier.size(18.dp))
                                    }
                                }
                                HorizontalDivider(color = ColorSurfaceHigh, thickness = 0.5.dp)
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── Status pill ──────────────────────────────────────────────────
            val (pillColor, pillText) = when {
                privateCallState.error != null -> ColorError to "Private call: ${privateCallState.error}"
                // Mic/voice errors take priority over the connected status so a failed
                // transmit (e.g. wedged mic) is visible instead of a green "online".
                voiceState.error != null -> ColorError to "⚠ ${voiceState.error}"
                voiceState.connected -> ColorOnline to "● ${selectedGroup?.name ?: "Connected"} · ${voiceState.participantCount} online"
                session.loggedIn -> ColorTextSecondary to "○ Tap Groups to connect"
                else -> ColorTextSecondary to "○ Not logged in"
            }
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(pillColor.copy(alpha = 0.15f))
                    .padding(horizontal = 16.dp, vertical = 6.dp),
            ) {
                Text(pillText, color = pillColor, fontSize = 12.sp)
            }

            // ── PTT button + waveform fill remaining space ───────────────────
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    WaveformBars(active = isTalking || voiceState.talking)

                    Spacer(Modifier.height(20.dp))

                    PttButton(
                        state = pttState,
                        size = pttButtonSize,
                        labelOverride = pttButtonLabel,
                        unitName = session.userName,
                        onPress = {
                            if (voiceState.connected) {
                                isTalking = true
                                pttVm.startTalking()
                            }
                        },
                        onRelease = {
                            if (isTalking) {
                                isTalking = false
                                pttVm.stopTalking()
                            }
                        },
                    )

                    Spacer(Modifier.height(16.dp))

                    val floorText = when {
                        voiceState.talking -> "You are transmitting"
                        !voiceState.floorHolderName.isNullOrBlank() -> "Speaking: ${voiceState.floorHolderName}"
                        else -> "Floor: clear"
                    }
                    Text(floorText, color = ColorTextSecondary, fontSize = 13.sp)
                }
            }

        }
    }
}

@Composable
private fun WaveformBars(active: Boolean) {
    val infiniteTransition = rememberInfiniteTransition(label = "wave")
    val heights = (0..6).map { i ->
        val height by infiniteTransition.animateFloat(
            initialValue = 4f,
            targetValue = if (active) (16f + i * 8f) else 6f,
            animationSpec = infiniteRepeatable(
                animation = tween(300 + i * 80, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "bar_$i",
        )
        height
    }

    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.height(48.dp),
    ) {
        heights.forEach { h ->
            Box(
                modifier = Modifier
                    .size(width = 4.dp, height = h.dp)
                    .clip(CircleShape)
                    .background(if (active) ColorAccent else ColorAccent.copy(alpha = 0.25f)),
            )
        }
    }
}
