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

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.pushcomm.ptt.ui.components.MessageBubble
import com.pushcomm.ptt.ui.theme.ColorAccent
import com.pushcomm.ptt.ui.theme.ColorBackground
import com.pushcomm.ptt.ui.theme.ColorError
import com.pushcomm.ptt.ui.theme.ColorSidebar
import com.pushcomm.ptt.ui.theme.ColorSurface
import com.pushcomm.ptt.ui.theme.ColorSurfaceHigh
import com.pushcomm.ptt.ui.theme.ColorTextSecondary
import com.pushcomm.ptt.viewmodel.AppViewModel
import com.pushcomm.ptt.viewmodel.ChatTarget
import com.pushcomm.ptt.viewmodel.MessagesViewModel
import kotlinx.coroutines.delay
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    target: ChatTarget,
    appVm: AppViewModel,
    messagesVm: MessagesViewModel,
    onBack: () -> Unit,
    onViewLocation: (lat: Double, lon: Double) -> Unit = { _, _ -> },
) {
    val session by appVm.session.collectAsState()
    val state by messagesVm.state.collectAsState()
    val listState = rememberLazyListState()
    val context = LocalContext.current

    var inputText by remember { mutableStateOf("") }
    var showAttachSheet by remember { mutableStateOf(false) }
    var isRecording by remember { mutableStateOf(false) }
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var audioFile by remember { mutableStateOf<File?>(null) }
    var attachmentError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(target) {
        messagesVm.openChat(session.baseUrl, session.accessToken, target)
    }

    // Poll for incoming messages every 5 seconds while chat is open
    LaunchedEffect(target) {
        while (true) {
            delay(5_000)
            val s = appVm.session.value
            if (s.loggedIn) messagesVm.loadThread(s.baseUrl, s.accessToken)
        }
    }

    LaunchedEffect(state.thread.size) {
        if (state.thread.isNotEmpty()) listState.animateScrollToItem(state.thread.size - 1)
    }

    // Camera capture — hand off to the device's camera app via
    // ACTION_IMAGE_CAPTURE and read back the JPEG we asked it to write. The
    // in-app CameraX capture path is part of the commercial build, for OEM
    // handsets that ship no camera app and run under lock-task.
    var pendingPhoto by remember { mutableStateOf<File?>(null) }
    val takePictureLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture(),
    ) { saved ->
        val file = pendingPhoto
        pendingPhoto = null
        if (saved && file != null && file.exists() && file.length() > 0) {
            messagesVm.sendFile(session.baseUrl, session.accessToken, file, "image/jpeg")
        }
    }

    fun openCameraCapture() {
        attachmentError = null
        val dir = File(context.cacheDir, "camera").also { it.mkdirs() }
        val file = File(dir, "${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        pendingPhoto = file
        runCatching { takePictureLauncher.launch(uri) }.onFailure {
            pendingPhoto = null
            attachmentError = "No camera app available on this device."
        }
    }

    // Saved photo launcher — Android Photo Picker when available, no storage permission required.
    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        attachmentError = null
        val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
        val ext = if (mimeType.startsWith("image")) "jpg" else "bin"
        val dir = File(context.cacheDir, "camera").also { it.mkdirs() }
        val file = File(dir, "${System.currentTimeMillis()}.$ext")
        context.contentResolver.openInputStream(uri)?.use { input ->
            file.outputStream().use { output -> input.copyTo(output) }
        }
        messagesVm.sendFile(session.baseUrl, session.accessToken, file, mimeType)
    }

    Column(modifier = Modifier.fillMaxSize().background(ColorBackground)) {
        // Error banner
        val error = state.error ?: attachmentError
        if (error != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ColorError)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = error,
                    color = Color.White,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { messagesVm.clearError(); attachmentError = null }, modifier = Modifier.size(28.dp)) {
                    Icon(Icons.Default.Close, contentDescription = "Dismiss", tint = Color.White, modifier = Modifier.size(16.dp))
                }
            }
        }

        // Top app bar
        TopAppBar(
            title = {
                Text(target.title, color = Color.White, fontWeight = FontWeight.SemiBold)
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White)
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = ColorSidebar),
        )

        // Message list
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).padding(vertical = 8.dp),
        ) {
            items(state.thread, key = { it.id }) { msg ->
                MessageBubble(
                    message = msg,
                    currentUserId = session.userId,
                    baseUrl = session.baseUrl,
                    accessToken = session.accessToken,
                    onViewLocation = onViewLocation,
                )
                Spacer(Modifier.height(4.dp))
            }
        }

        // Bottom input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ColorSidebar)
                .padding(horizontal = 8.dp, vertical = 6.dp)
                .imePadding()
                .navigationBarsPadding(),
            verticalAlignment = Alignment.Bottom,
        ) {
            // Attach button
            IconButton(onClick = { showAttachSheet = true }) {
                Icon(Icons.Default.AttachFile, contentDescription = "Attach", tint = ColorTextSecondary)
            }

            // Photo shortcut
            IconButton(onClick = { showAttachSheet = true }) {
                Icon(Icons.Default.Image, contentDescription = "Photo", tint = ColorTextSecondary)
            }

            // Location shortcut
            IconButton(onClick = {
                val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
                @Suppress("MissingPermission")
                val loc = runCatching {
                    lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                        ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                        ?: lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
                }.getOrNull()
                if (loc != null) {
                    messagesVm.sendText(
                        session.baseUrl, session.accessToken,
                        "[location]${loc.latitude},${loc.longitude}",
                        session.userId,
                    )
                }
            }) {
                Icon(Icons.Default.LocationOn, contentDescription = "Share Location", tint = ColorTextSecondary)
            }

            // Text input
            OutlinedTextField(
                value = inputText,
                onValueChange = { inputText = it },
                placeholder = { Text("Message", color = ColorTextSecondary) },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(24.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = ColorAccent,
                    unfocusedBorderColor = ColorSurfaceHigh,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    cursorColor = ColorAccent,
                    focusedContainerColor = ColorSurface,
                    unfocusedContainerColor = ColorSurface,
                ),
                maxLines = 4,
            )

            Spacer(Modifier.width(4.dp))

            // Send / mic
            if (inputText.isNotBlank()) {
                IconButton(
                    onClick = {
                        messagesVm.sendText(session.baseUrl, session.accessToken, inputText, session.userId)
                        inputText = ""
                    },
                ) {
                    Box(
                        modifier = Modifier.size(40.dp).clip(CircleShape).background(ColorAccent),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                }
            } else {
                IconButton(
                    onClick = {
                        if (isRecording) {
                            recorder?.stop()
                            recorder?.release()
                            recorder = null
                            isRecording = false
                            audioFile?.let { file ->
                                messagesVm.sendFile(session.baseUrl, session.accessToken, file, "audio/mpeg")
                            }
                        } else {
                            val dir = File(context.cacheDir, "audio").also { it.mkdirs() }
                            val file = File(dir, "${System.currentTimeMillis()}.mp3")
                            audioFile = file
                            recorder = createRecorder(context, file)
                            recorder?.start()
                            isRecording = true
                        }
                    },
                ) {
                    Box(
                        modifier = Modifier.size(40.dp).clip(CircleShape)
                            .background(if (isRecording) ColorAccent else ColorSurfaceHigh),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.Mic, contentDescription = "Record", tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }

    // Attach bottom sheet
    if (showAttachSheet) {
        val sheetState = rememberModalBottomSheetState()
        ModalBottomSheet(
            onDismissRequest = { showAttachSheet = false },
            sheetState = sheetState,
            containerColor = ColorSurface,
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    "Share Photo",
                    color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp,
                )
                Spacer(Modifier.height(16.dp))
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        AttachOption(Icons.Default.CameraAlt, "Take Photo") {
                            showAttachSheet = false
                            openCameraCapture()
                        }
                        AttachOption(Icons.Default.Image, "Saved Photo") {
                            showAttachSheet = false
                            galleryLauncher.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                            )
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        AttachOption(Icons.Default.LocationOn, "Location") {
                            showAttachSheet = false
                            val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
                            @Suppress("MissingPermission")
                            val loc = runCatching {
                                lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                                    ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                                    ?: lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
                            }.getOrNull()
                            if (loc != null) {
                                messagesVm.sendText(
                                    session.baseUrl, session.accessToken,
                                    "[location]${loc.latitude},${loc.longitude}",
                                    session.userId,
                                )
                            }
                        }
                        Spacer(Modifier.size(56.dp))
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun AttachOption(icon: ImageVector, label: String, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(
            onClick = onClick,
            modifier = Modifier.size(56.dp).clip(CircleShape).background(ColorSurfaceHigh),
        ) {
            Icon(icon, contentDescription = label, tint = ColorAccent, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(4.dp))
        Text(label, color = ColorTextSecondary, fontSize = 12.sp)
    }
}

@Suppress("DEPRECATION")
private fun createRecorder(context: Context, output: File): MediaRecorder {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        MediaRecorder(context)
    } else {
        MediaRecorder()
    }.apply {
        setAudioSource(MediaRecorder.AudioSource.MIC)
        setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        setOutputFile(output.absolutePath)
        prepare()
    }
}
