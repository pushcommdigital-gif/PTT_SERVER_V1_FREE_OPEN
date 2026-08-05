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

import android.media.MediaPlayer
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import android.net.Uri
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.pushcomm.ptt.MessageData
import com.pushcomm.ptt.ui.theme.ColorAccent
import com.pushcomm.ptt.ui.theme.ColorSurface
import com.pushcomm.ptt.ui.theme.ColorTextSecondary
import java.net.URLEncoder
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val timeFmt: DateTimeFormatter =
    DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

@Composable
fun MessageBubble(
    message: MessageData,
    currentUserId: String,
    baseUrl: String,
    accessToken: String = "",
    onViewLocation: (lat: Double, lon: Double) -> Unit = { _, _ -> },
) {
    val isMine = message.senderId == currentUserId
    val bubbleColor = if (isMine) ColorAccent else ColorSurface
    val textColor = Color.White
    val align = if (isMine) Arrangement.End else Arrangement.Start
    val bubbleShape = if (isMine) {
        RoundedCornerShape(topStart = 16.dp, topEnd = 4.dp, bottomStart = 16.dp, bottomEnd = 16.dp)
    } else {
        RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomStart = 16.dp, bottomEnd = 16.dp)
    }

    val context = LocalContext.current
    val maxWidth = (LocalConfiguration.current.screenWidthDp * 0.72).dp
    val timeStr = runCatching {
        timeFmt.format(Instant.parse(message.createdAt))
    }.getOrElse { "" }

    val senderLabel = if (!isMine) {
        "${message.senderFirstName.orEmpty()} ${message.senderLastName.orEmpty()}".trim()
    } else null

    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp),
        horizontalArrangement = align,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = maxWidth)
                .clip(bubbleShape)
                .background(bubbleColor)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Column {
                if (senderLabel != null) {
                    Text(
                        text = senderLabel,
                        color = ColorAccent,
                        fontSize = 11.sp,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                    )
                    Spacer(Modifier.height(2.dp))
                }

                when {
                    message.body.startsWith("[image]") -> {
                        val imagePath = message.body.removePrefix("[image]")
                        val authSuffix = if (accessToken.isBlank()) {
                            ""
                        } else {
                            val separator = if (imagePath.contains("?")) "&" else "?"
                            "${separator}token=${URLEncoder.encode(accessToken, "UTF-8")}"
                        }
                        val imageUrl = "$baseUrl$imagePath$authSuffix"
                        AsyncImage(
                            model = imageUrl,
                            contentDescription = "Image",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .size(200.dp)
                                .clip(RoundedCornerShape(8.dp)),
                        )
                    }
                    message.body == "[audio]" -> {
                        AudioMessagePlayer(
                            audioUrl = "$baseUrl/api/messages/${message.id}/audio",
                            accessToken = accessToken,
                            textColor = textColor,
                        )
                    }
                    message.body.startsWith("[location]") -> {
                        val coords = message.body.removePrefix("[location]")
                        val parts = coords.split(",")
                        val lat = parts.getOrNull(0)?.toDoubleOrNull()
                        val lon = parts.getOrNull(1)?.toDoubleOrNull()
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color.White.copy(alpha = 0.12f))
                                .clickable(enabled = lat != null && lon != null) {
                                    onViewLocation(lat!!, lon!!)
                                }
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                        ) {
                            Icon(
                                Icons.Default.LocationOn,
                                contentDescription = "Location",
                                tint = androidx.compose.ui.graphics.Color(0xFF4CAF50),
                                modifier = Modifier.size(22.dp),
                            )
                            Column {
                                Text("Location", color = textColor, fontSize = 13.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                                if (lat != null && lon != null) {
                                    Text(
                                        "${"%.5f".format(lat)}, ${"%.5f".format(lon)}",
                                        color = textColor.copy(alpha = 0.65f),
                                        fontSize = 10.sp,
                                    )
                                }
                                Text("Tap for directions", color = androidx.compose.ui.graphics.Color(0xFF4CAF50).copy(alpha = 0.8f), fontSize = 9.sp)
                            }
                        }
                    }
                    message.body.startsWith("[file]") -> {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.AttachFile, contentDescription = "File", tint = textColor, modifier = Modifier.size(20.dp))
                            Text(" ${message.body.removePrefix("[file]")}", color = textColor, fontSize = 14.sp)
                        }
                    }
                    else -> {
                        Text(text = message.body, color = textColor, fontSize = 15.sp)
                    }
                }

                Spacer(Modifier.height(2.dp))
                Text(
                    text = timeStr,
                    color = Color.White.copy(alpha = 0.55f),
                    fontSize = 10.sp,
                    textAlign = if (isMine) TextAlign.End else TextAlign.Start,
                    modifier = Modifier.align(if (isMine) Alignment.End else Alignment.Start),
                )
            }
        }
    }
}

@Composable
private fun AudioMessagePlayer(
    audioUrl: String,
    accessToken: String,
    textColor: Color,
) {
    val context = LocalContext.current
    var isPlaying by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    val player = remember { mutableStateOf<MediaPlayer?>(null) }

    DisposableEffect(audioUrl) {
        onDispose {
            player.value?.release()
            player.value = null
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center,
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = ColorAccent,
                    strokeWidth = 2.dp,
                )
            } else {
                IconButton(
                    onClick = {
                        val mp = player.value
                        if (mp != null && isPlaying) {
                            mp.pause()
                            isPlaying = false
                        } else if (mp != null && !isPlaying) {
                            mp.start()
                            isPlaying = true
                        } else {
                            isLoading = true
                            val newMp = MediaPlayer()
                            newMp.setDataSource(
                                context,
                                Uri.parse(audioUrl),
                                mapOf("Authorization" to "Bearer $accessToken"),
                            )
                            newMp.setOnPreparedListener {
                                isLoading = false
                                isPlaying = true
                                it.start()
                            }
                            newMp.setOnCompletionListener {
                                isPlaying = false
                            }
                            newMp.setOnErrorListener { _, _, _ ->
                                isLoading = false
                                isPlaying = false
                                true
                            }
                            newMp.prepareAsync()
                            player.value = newMp
                        }
                    },
                    modifier = Modifier.size(36.dp),
                ) {
                    Icon(
                        if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (isPlaying) "Pause" else "Play",
                        tint = textColor,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
        Text("Voice message", color = textColor.copy(alpha = 0.8f), fontSize = 13.sp)
    }
}
