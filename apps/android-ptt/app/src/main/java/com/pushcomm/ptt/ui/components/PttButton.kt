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
package com.pushcomm.ptt.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pushcomm.ptt.ui.theme.ColorAccent
import com.pushcomm.ptt.ui.theme.ColorError

enum class PttButtonState { IDLE, TALKING, SOS }

@Composable
fun PttButton(
    state: PttButtonState,
    size: Dp = 160.dp,
    labelOverride: String? = null,
    unitName: String? = null,
    onPress: () -> Unit,
    onRelease: () -> Unit,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "ptt_pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.12f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulse_scale",
    )

    val glowAlpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 0.7f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "glow_alpha",
    )

    val activeScale = when (state) {
        PttButtonState.TALKING -> pulseScale
        PttButtonState.SOS     -> pulseScale * 1.05f
        PttButtonState.IDLE    -> 1f
    }

    val fillColor = when (state) {
        PttButtonState.TALKING -> Color.White
        PttButtonState.SOS     -> ColorError
        PttButtonState.IDLE    -> ColorAccent
    }

    val glowColor = when (state) {
        PttButtonState.TALKING -> Color.White.copy(alpha = glowAlpha * 0.4f)
        PttButtonState.SOS     -> ColorError.copy(alpha = glowAlpha * 0.6f)
        PttButtonState.IDLE    -> ColorAccent.copy(alpha = 0.0f)
    }

    val stateLabel = when (state) {
        PttButtonState.TALKING -> "TRANSMITTING"
        PttButtonState.SOS     -> "SOS ACTIVE"
        PttButtonState.IDLE    -> "HOLD TO TALK"
    }

    val labelColor = when (state) {
        PttButtonState.TALKING -> ColorAccent
        PttButtonState.SOS     -> Color.White
        PttButtonState.IDLE    -> Color.White
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(size)
            .scale(activeScale)
            .drawBehind { drawGlow(glowColor, size.toPx()) }
            .clip(CircleShape)
            .drawBehind {
                drawCircle(fillColor)
                drawCircle(Color.Black.copy(alpha = 0.15f), radius = size.toPx() / 2 - 6.dp.toPx())
            }
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        onPress()
                        tryAwaitRelease()
                        onRelease()
                    },
                )
            },
    ) {
        if (labelOverride != null) {
            // Someone else is speaking — show that instead of our own identity.
            Text(
                text = labelOverride,
                color = labelColor,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
        } else {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(horizontal = 16.dp),
            ) {
                if (!unitName.isNullOrBlank()) {
                    Text(
                        text = unitName,
                        color = labelColor,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(3.dp))
                }
                Text(
                    text = stateLabel,
                    color = labelColor.copy(alpha = 0.9f),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

private fun DrawScope.drawGlow(color: Color, sizePx: Float) {
    if (color.alpha < 0.01f) return
    for (i in 1..4) {
        drawCircle(
            color = color.copy(alpha = color.alpha / i),
            radius = sizePx / 2 + i * 12.dp.toPx(),
        )
    }
}
