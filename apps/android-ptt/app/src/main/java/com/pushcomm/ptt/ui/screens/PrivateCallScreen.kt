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

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pushcomm.ptt.ui.components.PttButton
import com.pushcomm.ptt.ui.components.PttButtonState
import com.pushcomm.ptt.ui.theme.ColorAccent
import com.pushcomm.ptt.ui.theme.ColorBackground
import com.pushcomm.ptt.ui.theme.ColorError
import com.pushcomm.ptt.ui.theme.ColorOnline
import com.pushcomm.ptt.ui.theme.ColorSurface
import com.pushcomm.ptt.ui.theme.ColorTextSecondary
import com.pushcomm.ptt.viewmodel.PrivateCallViewModel
import com.pushcomm.ptt.viewmodel.PttViewModel

@Composable
fun PrivateCallScreen(
    privateCallVm: PrivateCallViewModel,
    pttVm: PttViewModel,
    onEnd: () -> Unit,
    baseUrl: String,
    token: String,
) {
    val state by privateCallVm.state.collectAsState()
    val vs = state.voiceState
    var isTalking by remember { mutableStateOf(false) }
    var groupMuted by remember { mutableStateOf(false) }

    // Private calls should not compete with group or All Call audio.
    DisposableEffect(Unit) {
        groupMuted = true
        pttVm.muteGroupAudio(true)
        onDispose { pttVm.muteGroupAudio(false) }
    }

    val pttState = when {
        isTalking -> PttButtonState.TALKING
        else -> PttButtonState.IDLE
    }
    val endCall = {
        privateCallVm.hangUp(baseUrl, token)
        onEnd()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ColorBackground),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
        ) {
            Spacer(Modifier.height(16.dp))

            // ── Header ──────────────────────────────────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Private Call",
                    color = ColorTextSecondary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Normal,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    IconButton(
                        onClick = {
                            groupMuted = !groupMuted
                            pttVm.muteGroupAudio(groupMuted)
                        },
                        modifier = Modifier.size(40.dp),
                    ) {
                        Icon(
                            imageVector = if (groupMuted) Icons.Default.VolumeOff else Icons.Default.VolumeUp,
                            contentDescription = if (groupMuted) "Unmute group audio" else "Mute group audio",
                            tint = if (groupMuted) ColorError else ColorTextSecondary,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    IconButton(
                        onClick = endCall,
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(ColorError),
                    ) {
                        Icon(
                            imageVector = Icons.Default.CallEnd,
                            contentDescription = "End private call",
                            tint = Color.White,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))

            // Avatar circle
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .background(ColorSurface),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.Person, contentDescription = null, tint = ColorTextSecondary, modifier = Modifier.size(36.dp))
            }
            Spacer(Modifier.height(12.dp))

            Text(
                text = state.targetName.ifBlank { "Unknown" },
                color = Color.White,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )

            Spacer(Modifier.height(8.dp))

            // ── Status pill ─────────────────────────────────────────────────
            val callError = state.error ?: vs.error
            val (pillColor, pillText) = when {
                callError != null -> ColorError to "Private call: $callError"
                vs.connected -> ColorOnline to "● Connected · ${vs.participantCount} online"
                vs.error != null -> ColorError to "⚠ ${vs.error}"
                else -> ColorTextSecondary to "○ Connecting…"
            }
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(pillColor.copy(alpha = 0.15f))
                    .padding(horizontal = 16.dp, vertical = 6.dp),
            ) {
                Text(pillText, color = pillColor, fontSize = 13.sp)
            }

            Spacer(Modifier.height(20.dp))

            // ── Waveform ───────────────────────────────────────────────────
            WaveformBarsPrivate(active = isTalking || vs.talking)

            Spacer(Modifier.height(20.dp))

            // ── PTT button ─────────────────────────────────────────────────
            PttButton(
                state = pttState,
                size = 148.dp,
                onPress = {
                    if (vs.connected) {
                        isTalking = true
                        privateCallVm.startTalking()
                    }
                },
                onRelease = {
                    if (isTalking) {
                        isTalking = false
                        privateCallVm.stopTalking()
                    }
                },
            )

            Spacer(Modifier.height(16.dp))

            // ── Floor indicator ────────────────────────────────────────────
            val floorText = when {
                vs.talking -> "You are transmitting"
                !vs.floorHolderName.isNullOrBlank() -> "Speaking: ${vs.floorHolderName}"
                else -> "Floor: clear"
            }
            Text(floorText, color = ColorTextSecondary, fontSize = 13.sp)

            Spacer(Modifier.weight(1f))

            // ── End Call button ────────────────────────────────────────────
            Button(
                onClick = endCall,
                colors = ButtonDefaults.buttonColors(containerColor = ColorError),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.CallEnd, contentDescription = "End call", tint = Color.White, modifier = Modifier.size(18.dp))
                Text("  End Call", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }

            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun WaveformBarsPrivate(active: Boolean) {
    val infiniteTransition = rememberInfiniteTransition(label = "wave_private")
    val heights = (0..6).map { i ->
        val h by infiniteTransition.animateFloat(
            initialValue = 4f,
            targetValue = if (active) (16f + i * 8f) else 6f,
            animationSpec = infiniteRepeatable(
                animation = tween(300 + i * 80, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "bar_priv_$i",
        )
        h
    }

    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.height(60.dp),
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
