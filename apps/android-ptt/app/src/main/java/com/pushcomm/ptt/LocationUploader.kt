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
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** A GPS fix waiting to be delivered (from the on-device store-and-forward queue). */
data class QueuedFix(
    val id: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float?,
    val speed: Float?,
    val heading: Float?,
    val altitude: Double?,
    val ts: Long, // epoch millis when the fix was recorded on the device
) {
    fun toFix() = LocationFix(latitude, longitude, accuracy, speed, heading, altitude, ts)
}

/**
 * Persistent FIFO queue of GPS fixes, backed by SQLite. Survives process death / reboot,
 * so fixes taken while offline are kept and backfilled when connectivity returns — this is
 * what makes the recorded track gap-free (and the source-level fix for the straight-line gaps).
 */
class LocationQueue(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "pushcomm_gps_queue.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE fixes(id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "lat REAL, lon REAL, acc REAL, spd REAL, hdg REAL, alt REAL, ts INTEGER)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldV: Int, newV: Int) {
        db.execSQL("DROP TABLE IF EXISTS fixes"); onCreate(db)
    }

    fun enqueue(f: QueuedFix) {
        writableDatabase.execSQL(
            "INSERT INTO fixes(lat,lon,acc,spd,hdg,alt,ts) VALUES(?,?,?,?,?,?,?)",
            arrayOf<Any?>(
                f.latitude, f.longitude,
                f.accuracy?.toDouble(), f.speed?.toDouble(), f.heading?.toDouble(),
                f.altitude, f.ts,
            ),
        )
    }

    fun peek(limit: Int): List<QueuedFix> {
        val out = ArrayList<QueuedFix>()
        readableDatabase.rawQuery(
            "SELECT id,lat,lon,acc,spd,hdg,alt,ts FROM fixes ORDER BY id ASC LIMIT ?",
            arrayOf(limit.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out.add(
                    QueuedFix(
                        id = c.getLong(0),
                        latitude = c.getDouble(1),
                        longitude = c.getDouble(2),
                        accuracy = if (c.isNull(3)) null else c.getFloat(3),
                        speed = if (c.isNull(4)) null else c.getFloat(4),
                        heading = if (c.isNull(5)) null else c.getFloat(5),
                        altitude = if (c.isNull(6)) null else c.getDouble(6),
                        ts = c.getLong(7),
                    )
                )
            }
        }
        return out
    }

    fun delete(ids: List<Long>) {
        if (ids.isEmpty()) return
        writableDatabase.execSQL("DELETE FROM fixes WHERE id IN (${ids.joinToString(",")})")
    }

    /** Bound storage: keep only the newest [max] fixes (drop the oldest if a device is offline for days). */
    fun trimTo(max: Int) {
        writableDatabase.execSQL(
            "DELETE FROM fixes WHERE id NOT IN (SELECT id FROM fixes ORDER BY id DESC LIMIT $max)"
        )
    }
}

/**
 * Store-and-forward uploader. Every GPS fix is enqueued, then the queue is drained to the
 * server: when online it delivers ~immediately (near-real-time, so the live map/SOS/geofences
 * keep working); when offline it keeps the fixes and backfills the backlog on reconnect via the
 * batch endpoint. One shared queue for both the foreground service and the map view.
 */
object LocationUploader {
    private const val BATCH_SIZE = 200
    private const val MAX_QUEUE = 20_000       // ~2+ days at one fix / 10s
    private const val DRAIN_INTERVAL_MS = 15_000L

    private val api = PushcommApi()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex() // serialize DB access + drains

    @Volatile private var queue: LocationQueue? = null
    @Volatile private var started = false

    private fun ensureQueue(context: Context): LocationQueue =
        queue ?: LocationQueue(context).also { queue = it }

    /** Enqueue a fix and kick a drain. Safe to call from any thread. */
    fun submit(context: Context, fix: QueuedFix) {
        val appCtx = context.applicationContext
        scope.launch {
            mutex.withLock {
                val q = ensureQueue(appCtx)
                runCatching { q.enqueue(fix); q.trimTo(MAX_QUEUE) }
                drainLocked(appCtx, q)
            }
        }
    }

    /** Start the periodic drain (retries the backlog even when no new fixes arrive). Idempotent. */
    fun start(context: Context) {
        if (started) return
        started = true
        val appCtx = context.applicationContext
        scope.launch {
            while (true) {
                mutex.withLock { runCatching { drainLocked(appCtx, ensureQueue(appCtx)) } }
                delay(DRAIN_INTERVAL_MS)
            }
        }
    }

    private suspend fun drainLocked(context: Context, q: LocationQueue) {
        val prefs = SessionPreferences(context)
        val baseUrl = prefs.baseUrl
        val token = prefs.accessToken
        if (baseUrl.isBlank() || token.isBlank()) return
        while (true) {
            val batch = runCatching { q.peek(BATCH_SIZE) }.getOrNull() ?: break
            if (batch.isEmpty()) break
            val ok = runCatching { api.postLocationBatch(baseUrl, token, batch.map { it.toFix() }) }.getOrDefault(false)
            if (!ok) break // offline / error → keep them, retry on the next drain
            runCatching { q.delete(batch.map { it.id }) }
            if (batch.size < BATCH_SIZE) break
        }
    }
}
