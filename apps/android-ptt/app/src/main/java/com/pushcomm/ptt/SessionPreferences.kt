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

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Persists login session across app restarts so operators don't need
 * to re-enter credentials every time they pick up the device.
 */
class SessionPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("pushcomm_session", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = prefs.getString("base_url", "") ?: ""
        set(v) { prefs.edit().putString("base_url", v).apply() }

    var accessToken: String
        get() = prefs.getString("access_token", "") ?: ""
        set(v) { prefs.edit().putString("access_token", v).apply() }

    var refreshToken: String
        get() = prefs.getString("refresh_token", "") ?: ""
        set(v) { prefs.edit().putString("refresh_token", v).apply() }

    var userId: String
        get() = prefs.getString("user_id", "") ?: ""
        set(v) { prefs.edit().putString("user_id", v).apply() }

    var userName: String
        get() = prefs.getString("user_name", "") ?: ""
        set(v) { prefs.edit().putString("user_name", v).apply() }

    var callsign: String
        get() = prefs.getString("callsign", "") ?: ""
        set(v) { prefs.edit().putString("callsign", v).apply() }

    var savedUsername: String
        get() = prefs.getString("saved_username", "") ?: ""
        set(v) { prefs.edit().putString("saved_username", v).apply() }

    /**
     * The user's password, stored encrypted (AES-GCM, key in the Android
     * Keystore) so the app can silently re-authenticate when tokens expire
     * instead of stranding a field operator at the login screen. Blank if
     * unset or if decryption fails (e.g. key invalidated by a factory reset).
     */
    var savedPassword: String
        get() = prefs.getString("saved_password_enc", "")
            ?.takeIf { it.isNotBlank() }
            ?.let { CredentialCrypto.decrypt(it) }
            ?: ""
        set(v) {
            prefs.edit()
                .putString("saved_password_enc", if (v.isBlank()) "" else CredentialCrypto.encrypt(v))
                .apply()
        }

    var selectedGroupId: String
        get() = prefs.getString("selected_group_id", "") ?: ""
        set(v) { prefs.edit().putString("selected_group_id", v).apply() }

    var fcmToken: String
        get() = prefs.getString("fcm_token", "") ?: ""
        set(v) { prefs.edit().putString("fcm_token", v).apply() }

    // Keycode of an optional hardware PTT button (a paired BT mic, or a device
    // key the operator binds in Settings). -1 means "not set" — the default on
    // the smartphone flavor, where PTT is the on-screen button. OEM handsets
    // with a built-in PTT key ship their defaults in the commercial build.
    var hardwarePttKeycode: Int
        get() = prefs.getInt("hardware_ptt_keycode", -1)
        set(v) { prefs.edit().putInt("hardware_ptt_keycode", v).apply() }

    var hardwarePttMode: String
        get() = prefs.getString("hardware_ptt_mode", "hold") ?: "hold"
        set(v) { prefs.edit().putString("hardware_ptt_mode", v).apply() }

    // Pending incoming call stored by PushcommFcmService when app was killed
    var pendingCallInitiatorId: String
        get() = prefs.getString("pending_call_initiator_id", "") ?: ""
        set(v) { prefs.edit().putString("pending_call_initiator_id", v).apply() }

    var pendingCallInitiatorName: String
        get() = prefs.getString("pending_call_initiator_name", "") ?: ""
        set(v) { prefs.edit().putString("pending_call_initiator_name", v).apply() }

    var pendingCallRoomName: String
        get() = prefs.getString("pending_call_room_name", "") ?: ""
        set(v) { prefs.edit().putString("pending_call_room_name", v).apply() }

    fun clearPendingCall() {
        prefs.edit()
            .remove("pending_call_initiator_id")
            .remove("pending_call_initiator_name")
            .remove("pending_call_room_name")
            .apply()
    }


    fun hasSession(): Boolean = accessToken.isNotBlank() && userId.isNotBlank()

    fun saveLoginResult(baseUrl: String, username: String, accessToken: String, refreshToken: String, userId: String, userName: String, callsign: String) {
        prefs.edit()
            .putString("base_url", baseUrl)
            .putString("saved_username", username)
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .putString("user_id", userId)
            .putString("user_name", userName)
            .putString("callsign", callsign)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}

/**
 * AES-256-GCM encryption for the stored password, with the key held in the
 * AndroidKeyStore (hardware-backed where available). Output is base64 of
 * IV (12 bytes) || ciphertext+tag. Decryption returns "" on any failure.
 */
private object CredentialCrypto {
    private const val KEY_ALIAS = "pushcomm_cred_key_v1"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val IV_LEN = 12

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun encrypt(plain: String): String = try {
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, secretKey()) }
        val iv = cipher.iv
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        Base64.encodeToString(iv + ct, Base64.NO_WRAP)
    } catch (e: Exception) {
        ""
    }

    fun decrypt(stored: String): String = try {
        val data = Base64.decode(stored, Base64.NO_WRAP)
        val iv = data.copyOfRange(0, IV_LEN)
        val ct = data.copyOfRange(IV_LEN, data.size)
        val cipher = Cipher.getInstance(TRANSFORM).apply {
            init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        }
        String(cipher.doFinal(ct), Charsets.UTF_8)
    } catch (e: Exception) {
        ""
    }
}
