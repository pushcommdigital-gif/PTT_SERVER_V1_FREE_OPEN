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
package com.pushcomm.ptt

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class PushcommFcmService : FirebaseMessagingService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val api = PushcommApi()

    /**
     * Called when a new FCM registration token is issued (first install or token rotation).
     * Saves it to prefs and posts it to the API if a session exists.
     */
    override fun onNewToken(token: String) {
        val prefs = SessionPreferences(this)
        prefs.fcmToken = token
        val baseUrl = prefs.baseUrl
        val accessToken = prefs.accessToken
        if (accessToken.isBlank()) return
        serviceScope.launch {
            runCatching { api.postFcmToken(baseUrl, accessToken, token) }
        }
    }

    /**
     * Called for every incoming data-only FCM message, including when the app is killed.
     */
    override fun onMessageReceived(message: RemoteMessage) {
        when (message.data["type"]) {
            "message" -> showMessageNotification(message.data)
            "private_call" -> showCallNotification(message.data)
            "sos" -> showSosNotification(message.data)
            "poi" -> showZoneAlertNotification(
                zoneName = message.data["poiName"] ?: "a zone",
                alertType = message.data["alertType"] ?: "enter",
            )
            "geofence" -> showZoneAlertNotification(
                zoneName = message.data["geofenceName"] ?: "a zone",
                alertType = message.data["alertType"] ?: "enter",
            )
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private fun ensureChannel(id: String, name: String, importance: Int) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(id) == null) {
            nm.createNotificationChannel(NotificationChannel(id, name, importance))
        }
    }

    private fun showMessageNotification(data: Map<String, String>) {
        ensureChannel("pushcomm_messages", "PushComm Messages", NotificationManager.IMPORTANCE_HIGH)
        val senderName = data["senderName"] ?: "Someone"
        val preview = data["preview"] ?: ""
        val groupName = data["groupName"]?.takeIf { it.isNotBlank() }
        val title = if (groupName != null) "$senderName · $groupName" else "Message from $senderName"

        val intent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        NotificationManagerCompat.from(this).notify(
            1003,
            NotificationCompat.Builder(this, "pushcomm_messages")
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle(title)
                .setContentText(preview)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(intent)
                .build(),
        )
    }

    private fun showSosNotification(data: Map<String, String>) {
        ensureChannel("pushcomm_sos", "PushComm SOS", NotificationManager.IMPORTANCE_HIGH)
        val senderName = data["senderName"]?.takeIf { it.isNotBlank() } ?: "A team member"
        val intent = PendingIntent.getActivity(
            this, 2,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        NotificationManagerCompat.from(this).notify(
            1005,
            NotificationCompat.Builder(this, "pushcomm_sos")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("SOS EMERGENCY")
                .setContentText("$senderName requires immediate assistance")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(intent)
                .build(),
        )
    }

    private fun showZoneAlertNotification(zoneName: String, alertType: String) {
        ensureChannel("pushcomm_zones", "PushComm Zone Alerts", NotificationManager.IMPORTANCE_HIGH)
        val verb = if (alertType == "enter") "Entered" else "Exited"
        val intent = PendingIntent.getActivity(
            this, 3,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        NotificationManagerCompat.from(this).notify(
            1006,
            NotificationCompat.Builder(this, "pushcomm_zones")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Zone Alert: $verb $zoneName")
                .setContentText("Tap to open app")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(intent)
                .build(),
        )
    }

    private fun showCallNotification(data: Map<String, String>) {
        ensureChannel("pushcomm_calls", "PushComm Calls", NotificationManager.IMPORTANCE_HIGH)
        val initiatorId = data["initiatorId"] ?: return
        val initiatorName = data["initiatorName"] ?: "Someone"
        val roomName = data["roomName"] ?: return

        // Store call data in prefs so MainActivity can auto-navigate when it wakes up
        val prefs = SessionPreferences(this)
        prefs.pendingCallInitiatorId = initiatorId
        prefs.pendingCallInitiatorName = initiatorName
        prefs.pendingCallRoomName = roomName

        val intent = PendingIntent.getActivity(
            this, 1,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        NotificationManagerCompat.from(this).notify(
            1004,
            NotificationCompat.Builder(this, "pushcomm_calls")
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle("Incoming call from $initiatorName")
                .setContentText("Tap to answer")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setFullScreenIntent(intent, true)
                .setContentIntent(intent)
                .build(),
        )
    }
}
