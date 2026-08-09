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

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.HandlerThread
import android.util.Log
import androidx.core.content.ContextCompat
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Scrapes button presses from Bluetooth PTT microphones (INRICO B01 and
 * peers) that route their PTT/SOS/channel-switch events over a *vendor*
 * Bluetooth channel rather than HID/AVRCP. We diagnosed in this session
 * that the B01's volume keys come through standard AVRCP (Android handles
 * them transparently) but PTT/SOS/unlabeled buttons fire ZERO HID events
 * and ZERO ACTION_MEDIA_BUTTON events. The only remaining transports are:
 *
 *   - **Classic SPP** (RFCOMM serial port) on the standard 1101 UUID,
 *     emitting ASCII or binary frames per press/release.
 *   - **BLE GATT notification** on a vendor characteristic (often inside
 *     a custom Nordic-UART-like service).
 *
 * Both paths are attempted in parallel. Every received byte is hex-dumped
 * to logcat under the `BtMicScrape` tag so we can identify the actual
 * protocol on a real device — without vendor docs, this listener starts
 * as a *diagnostic* tool. Once the wire format is known, [parseFrame]
 * gets the patterns and the [Callbacks] fire.
 *
 * Threading: SPP reads block, so we own a dedicated HandlerThread for the
 * connect+read loop. BLE callbacks come in on the system Binder thread —
 * we forward to a worker thread before calling user callbacks so a slow
 * downstream handler can't stall the Bluetooth stack.
 *
 * Lifecycle: [start] from a foreground service (we need
 * BLUETOOTH_CONNECT, BLUETOOTH_SCAN, and FGS type=connectedDevice).
 * Call [stop] in onDestroy to release the socket / GATT.
 */
class BtMicListener(
    private val context: Context,
    private val callbacks: Callbacks,
    /** Substrings to match against bonded device names (case-insensitive). */
    private val deviceNameHints: List<String> = listOf("B01", "INRICO", "PTT", "MIC"),
) {

    interface Callbacks {
        fun onPttPressed()
        fun onPttReleased()
        fun onSosTriggered()
        fun onUnlabeledButtonPressed()
    }

    companion object {
        private const val TAG = "BtMicScrape"
        /** Standard Serial Port Profile UUID. Most BT-Classic PTT mics use this. */
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        /** Standard "Client Characteristic Configuration" descriptor UUID — used to enable notify. */
        private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private val running = AtomicBoolean(false)
    private var sppThread: HandlerThread? = null
    private var sppSocket: BluetoothSocket? = null

    private val gattConnections = mutableListOf<BluetoothGatt>()

    /**
     * Timestamp (ms) of the most recent SOS confirm. The B01 firmware emits
     * a phantom +PTT=P/+PTT=R pulse ~4–6 seconds after every C:SOS* — looks
     * like an internal "confirmation chirp" path that wasn't meant to leak
     * onto the SPP channel. Witnessed 2026-05-23: 4 SOS presses produced
     * 4 phantom 1.5s PTT recordings on the dashboard. Suppress real-PTT
     * dispatch for [SOS_PTT_SUPPRESSION_MS] after every SOS so the chirp
     * doesn't open the mic or burn a recording row.
     */
    @Volatile private var lastSosAtMs: Long = 0L
    private val SOS_PTT_SUPPRESSION_MS = 7000L

    fun start() {
        if (!running.compareAndSet(false, true)) {
            Log.d(TAG, "start() called while already running — ignored")
            return
        }
        if (!hasBluetoothConnectPermission()) {
            Log.w(TAG, "BLUETOOTH_CONNECT not granted — cannot scrape BT mic")
            return
        }
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Log.w(TAG, "Bluetooth adapter unavailable or disabled — nothing to scrape")
            return
        }
        val bonded = safeBondedDevices(adapter)
        if (bonded.isEmpty()) {
            Log.i(TAG, "No bonded BT devices. Pair the mic first, then re-trigger.")
            return
        }
        Log.i(TAG, "Bonded devices (${bonded.size}):")
        for (d in bonded) {
            Log.i(TAG, "  - name='${safeName(d)}' addr=${d.address} type=${typeName(d.type)} bondState=${d.bondState}")
        }

        val matches = bonded.filter { matchesHints(safeName(it)) }
        val targets = if (matches.isNotEmpty()) matches else bonded
        if (matches.isEmpty()) {
            Log.w(TAG, "No bonded device matched name hints $deviceNameHints — falling back to ALL bonded devices for scrape")
        }

        for (device in targets) {
            tryStartSppForDevice(device)
            tryStartGattForDevice(device)
        }
    }

    fun stop() {
        if (!running.compareAndSet(true, false)) return
        runCatching { sppSocket?.close() }
        sppSocket = null
        sppThread?.quitSafely()
        sppThread = null
        synchronized(gattConnections) {
            for (g in gattConnections) {
                runCatching {
                    if (hasBluetoothConnectPermission()) {
                        @SuppressLint("MissingPermission")
                        g.close()
                    }
                }
            }
            gattConnections.clear()
        }
        Log.i(TAG, "stopped")
    }

    // ── SPP (RFCOMM) ──────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    private fun tryStartSppForDevice(device: BluetoothDevice) {
        val name = safeName(device)
        val thread = HandlerThread("btmic-spp-${device.address}").also { it.start() }
        sppThread = thread
        // Run the connect+read loop on the HandlerThread's looper so it's
        // off the main thread but still cleanly cancellable via quitSafely.
        android.os.Handler(thread.looper).post {
            var socket: BluetoothSocket? = null
            try {
                Log.i(TAG, "SPP connect attempt → '$name' (${device.address})")
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                // Discovery is expensive and known to interfere with RFCOMM;
                // cancel it just in case something kicked off a scan.
                (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)
                    ?.adapter?.cancelDiscovery()
                socket.connect() // blocking
                sppSocket = socket
                Log.i(TAG, "SPP connected to '$name'")

                val input = socket.inputStream
                val buf = ByteArray(256)
                while (running.get()) {
                    val n = try {
                        input.read(buf)
                    } catch (eof: IOException) {
                        Log.i(TAG, "SPP '$name' read returned IOException (peer closed?): ${eof.message}")
                        -1
                    }
                    if (n <= 0) break
                    val chunk = buf.copyOf(n)
                    Log.i(TAG, "SPP '$name' got ${n}B: ${hex(chunk)}  ascii='${ascii(chunk)}'")
                    dispatchFrame(chunk)
                }
            } catch (e: SecurityException) {
                Log.w(TAG, "SPP '$name' SecurityException — missing BLUETOOTH_CONNECT? ${e.message}")
            } catch (e: IOException) {
                // Most common case: device does not expose an SPP service
                // record. That's the signal to fall back to BLE scraping.
                Log.i(TAG, "SPP '$name' connect failed (likely no SPP server here): ${e.message}")
            } finally {
                runCatching { socket?.close() }
            }
        }
    }

    // ── BLE GATT ──────────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    private fun tryStartGattForDevice(device: BluetoothDevice) {
        val name = safeName(device)
        // BLE works regardless of bond type — and some PTT mics (notably the
        // INRICO B-series) expose their button channel as BLE notifications
        // even though they bond as Bluetooth Classic for audio. Subscribing
        // to all notify-capable characteristics is the only reliable way
        // without a vendor service UUID.
        Log.i(TAG, "GATT connect attempt → '$name' (${device.address})")
        val gatt = device.connectGatt(context, /* autoConnect= */ true, gattCallback)
        if (gatt != null) {
            synchronized(gattConnections) { gattConnections += gatt }
        }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val addr = gatt.device.address
            Log.i(TAG, "GATT $addr connection: status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                if (hasBluetoothConnectPermission()) gatt.discoverServices()
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val addr = gatt.device.address
            Log.i(TAG, "GATT $addr servicesDiscovered status=$status, ${gatt.services.size} services")
            for (svc in gatt.services) {
                Log.i(TAG, "GATT $addr svc=${svc.uuid}")
                for (chr in svc.characteristics) {
                    val props = chr.properties
                    val canNotify = props and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or
                        BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0
                    Log.i(TAG, "GATT $addr   chr=${chr.uuid} props=0x${"%02x".format(props)} canNotify=$canNotify")
                    if (canNotify && hasBluetoothConnectPermission()) {
                        runCatching {
                            gatt.setCharacteristicNotification(chr, true)
                            chr.getDescriptor(CCCD_UUID)?.let { cccd ->
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                    @Suppress("DEPRECATION")
                                    gatt.writeDescriptor(
                                        cccd,
                                        BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE,
                                    )
                                } else {
                                    @Suppress("DEPRECATION")
                                    cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                                    @Suppress("DEPRECATION")
                                    gatt.writeDescriptor(cccd)
                                }
                                Log.i(TAG, "GATT $addr     → subscribed to notifications on ${chr.uuid}")
                            }
                        }
                    }
                }
            }
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            Log.i(TAG, "GATT ${gatt.device.address} notify chr=${characteristic.uuid} ${value.size}B: ${hex(value)} ascii='${ascii(value)}'")
            dispatchFrame(value)
        }

        @Deprecated("Override for API < 33", level = DeprecationLevel.HIDDEN)
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            val v = characteristic.value ?: return
            Log.i(TAG, "GATT ${gatt.device.address} notify(legacy) chr=${characteristic.uuid} ${v.size}B: ${hex(v)} ascii='${ascii(v)}'")
            dispatchFrame(v)
        }
    }

    // ── Frame parsing (placeholder) ───────────────────────────────────────

    /**
     * INRICO B01 SPP protocol — decoded empirically on 2026-05-23. Frames
     * arrive as short ASCII commands over the RFCOMM stream. PTT releases
     * sometimes duplicate (firmware debounce); downstream
     * startTalking/stopTalking are already idempotent so duplicates are
     * harmless.
     *
     *   "+PTT=P"      PTT pressed
     *   "+PTT=R"      PTT released
     *   "C:SOS*"      SOS confirmed (firmware applies the hold-to-fire
     *                 timer; we do not need to time it on our side)
     *   "C:SP*"       SOS button raw down — IGNORED (we want the
     *                 hold-confirmed C:SOS* instead, same as a hardware SOS key)
     *   "C:SR*"       SOS button raw up — IGNORED
     *   "C:GP*"       Unlabeled (group/channel switch) pressed
     *   "C:GR*"       Unlabeled released — IGNORED (treat as a momentary
     *                 action; only the down edge does anything)
     *
     * Other vendor BT mics (Hytera SM26, Sena SR10, RuggedJam) speak
     * different but similar short-ASCII protocols. Add their frame
     * strings here when we test those devices — the SPP read loop is
     * already vendor-agnostic.
     */
    private fun dispatchFrame(frame: ByteArray) {
        if (frame.isEmpty()) return
        // Strip trailing nulls / whitespace BEFORE ascii conversion. The B01
        // appends 0x00 to its C:SOS* frame; our ascii() helper turns that into
        // '.' which would break the exact-string match below (this exact bug
        // shipped briefly and silently dropped SOS — fixed by trimming
        // at the byte level rather than after the substitution).
        var end = frame.size
        while (end > 0) {
            val b = frame[end - 1].toInt() and 0xFF
            if (b == 0x00 || b == 0x20 || b == 0x0A || b == 0x0D) end-- else break
        }
        val trimmed = if (end == frame.size) frame else frame.copyOf(end)
        val text = ascii(trimmed).uppercase()

        when (text) {
            "+PTT=P" -> {
                val sinceSos = System.currentTimeMillis() - lastSosAtMs
                if (sinceSos in 0..SOS_PTT_SUPPRESSION_MS) {
                    Log.i(TAG, "phantom PTT down suppressed (${sinceSos}ms after SOS)")
                } else {
                    safeFire("PTT down (B01)") { callbacks.onPttPressed() }
                }
            }
            "+PTT=R" -> {
                val sinceSos = System.currentTimeMillis() - lastSosAtMs
                if (sinceSos in 0..SOS_PTT_SUPPRESSION_MS) {
                    Log.i(TAG, "phantom PTT up suppressed (${sinceSos}ms after SOS)")
                } else {
                    safeFire("PTT up (B01)") { callbacks.onPttReleased() }
                }
            }
            "C:SOS*" -> {
                lastSosAtMs = System.currentTimeMillis()
                safeFire("SOS (B01)") { callbacks.onSosTriggered() }
            }
            "C:GP*" -> safeFire("Unlabeled press (B01)") { callbacks.onUnlabeledButtonPressed() }
            "C:SP*", "C:SR*", "C:GR*" -> {
                Log.d(TAG, "ignored known frame: '$text'")
            }
            else -> Log.d(TAG, "frame not recognized; raw=${hex(frame)} ascii='${ascii(frame)}'")
        }
    }

    private inline fun safeFire(label: String, block: () -> Unit) {
        Log.i(TAG, "FIRE: $label")
        runCatching { block() }.onFailure { Log.w(TAG, "callback for $label threw: ${it.message}") }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun hasBluetoothConnectPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.BLUETOOTH_CONNECT,
        ) == PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission")
    private fun safeBondedDevices(adapter: BluetoothAdapter): List<BluetoothDevice> {
        return try {
            adapter.bondedDevices?.toList() ?: emptyList()
        } catch (e: SecurityException) {
            Log.w(TAG, "bondedDevices SecurityException: ${e.message}")
            emptyList()
        }
    }

    @SuppressLint("MissingPermission")
    private fun safeName(d: BluetoothDevice): String = try {
        d.name ?: "?"
    } catch (_: SecurityException) {
        "?(no-perm)"
    }

    private fun matchesHints(name: String): Boolean {
        val u = name.uppercase()
        return deviceNameHints.any { u.contains(it.uppercase()) }
    }

    private fun typeName(t: Int): String = when (t) {
        BluetoothDevice.DEVICE_TYPE_CLASSIC -> "CLASSIC"
        BluetoothDevice.DEVICE_TYPE_LE -> "LE"
        BluetoothDevice.DEVICE_TYPE_DUAL -> "DUAL"
        else -> "UNKNOWN($t)"
    }

    private fun hex(b: ByteArray): String =
        b.joinToString(" ") { "%02x".format(it.toInt() and 0xff) }

    private fun ascii(b: ByteArray): String =
        String(b.map { if (it in 0x20..0x7e) it else '.'.code.toByte() }.toByteArray())
}
