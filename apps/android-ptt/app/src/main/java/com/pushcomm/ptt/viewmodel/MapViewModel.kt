package com.pushcomm.ptt.viewmodel

import android.annotation.SuppressLint
import android.app.Application
import android.location.Location
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.pushcomm.ptt.MapDriver
import com.pushcomm.ptt.PushcommApi
import android.os.HandlerThread
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class MapState(
    val drivers: List<MapDriver> = emptyList(),
    val myLocation: Location? = null,
    val loading: Boolean = false,
    val error: String? = null,
)

class MapViewModel(application: Application) : AndroidViewModel(application) {
    private val api = PushcommApi()
    private val fusedClient = LocationServices.getFusedLocationProviderClient(application)

    private val _state = MutableStateFlow(MapState())
    val state: StateFlow<MapState> = _state.asStateFlow()

    private val _selectedDriverId = MutableStateFlow<String?>(null)
    val selectedDriverId: StateFlow<String?> = _selectedDriverId.asStateFlow()

    fun selectDriver(id: String?) {
        _selectedDriverId.value = id
        if (id != null) _destinationSelected.value = false
    }

    private val _pendingCenter = MutableStateFlow<Pair<Double, Double>?>(null)
    val pendingCenter: StateFlow<Pair<Double, Double>?> = _pendingCenter.asStateFlow()

    private val _destinationPin = MutableStateFlow<Pair<Double, Double>?>(null)
    val destinationPin: StateFlow<Pair<Double, Double>?> = _destinationPin.asStateFlow()

    private val _destinationSelected = MutableStateFlow(false)
    val destinationSelected: StateFlow<Boolean> = _destinationSelected.asStateFlow()

    fun centerOn(lat: Double, lon: Double) {
        _pendingCenter.value = Pair(lat, lon)
        _destinationPin.value = Pair(lat, lon)
        _destinationSelected.value = false
    }
    fun consumeCenter() { _pendingCenter.value = null }
    fun selectDestination() { _destinationSelected.value = true }
    fun deselectDestination() { _destinationSelected.value = false }
    fun clearDestination() { _destinationPin.value = null; _destinationSelected.value = false }

    fun refreshNow(baseUrl: String, token: String) {
        viewModelScope.launch {
            runCatching {
                val overview = api.getMapOverview(baseUrl, token)
                _state.value = _state.value.copy(drivers = overview.drivers)
            }
        }
    }

    private var refreshJob: Job? = null
    private var locationCallback: LocationCallback? = null
    private var locationThread: HandlerThread? = null

    // ── GPS posting — always-on while logged in ───────────────────────────────

    /** Start posting GPS to the server. Idempotent — safe to call multiple times. */
    fun startGps(baseUrl: String, token: String) {
        startLocationUpdates(baseUrl, token)
    }

    /** Stop GPS posting — call on logout only. */
    fun stopGps() {
        locationCallback?.let { fusedClient.removeLocationUpdates(it) }
        locationCallback = null
        locationThread?.quitSafely()
        locationThread = null
    }

    // ── Map overview refresh — only while Map screen is visible ───────────────

    /** Start the 30-second map overview polling loop. */
    fun startMapRefresh(baseUrl: String, token: String) {
        startMapRefreshLoop(baseUrl, token)
    }

    /** Stop the map overview polling loop (GPS keeps running). */
    fun stopMapRefresh() {
        refreshJob?.cancel()
        refreshJob = null
    }

    // ── Convenience: start/stop both (used by MapScreen) ─────────────────────

    fun startTracking(baseUrl: String, token: String) {
        startGps(baseUrl, token)
        startMapRefresh(baseUrl, token)
    }

    /** Stops only the map refresh loop — GPS continues until stopGps() is called. */
    fun stopTracking() {
        stopMapRefresh()
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates(baseUrl: String, token: String) {
        // Remove any existing callback first so we never register duplicates
        locationCallback?.let { fusedClient.removeLocationUpdates(it) }
        locationCallback = null
        locationThread?.quitSafely()
        locationThread = null

        val thread = HandlerThread("pushcomm-map-gps").also { it.start() }
        locationThread = thread

        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                // Only drive the local "Me" marker here. The PttForegroundService is the
                // SINGLE uploader of GPS fixes — having the map upload too made the fused
                // provider's fix get enqueued twice, producing ~50% exact-duplicate rows
                // server-side (same timestamp/lat/lon) that skewed matching + storage.
                _state.value = _state.value.copy(myLocation = loc)
            }
        }
        locationCallback = cb

        // HIGH_ACCURACY = true GNSS (~5-10m); BALANCED (~100m Wi-Fi/cell) is too
        // coarse for road-level tracking. See PttForegroundService for the rationale.
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 15_000L)
            .setMinUpdateIntervalMillis(8_000L)
            .build()

        fusedClient.requestLocationUpdates(req, cb, thread.looper)

        // Seed "Me" immediately from the OS-cached last fix (instant, works indoors).
        // getCurrentLocation() will overwrite it with a fresh fix once acquired.
        fusedClient.lastLocation.addOnSuccessListener { last ->
            if (last != null && _state.value.myLocation == null) {
                _state.value = _state.value.copy(myLocation = last)
            }
        }

        fusedClient.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null)
            .addOnSuccessListener { loc ->
                if (loc == null) return@addOnSuccessListener
                _state.value = _state.value.copy(myLocation = loc)
                // No upload here — the PttForegroundService is the single GPS uploader.
            }
    }

    private fun startMapRefreshLoop(baseUrl: String, token: String) {
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            while (isActive) {
                try {
                    _state.value = _state.value.copy(loading = true)
                    val overview = api.getMapOverview(baseUrl, token)
                    _state.value = _state.value.copy(drivers = overview.drivers, loading = false)
                } catch (e: Exception) {
                    _state.value = _state.value.copy(loading = false, error = e.message)
                }
                delay(30_000L)
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        stopGps()
        stopMapRefresh()
    }
}
