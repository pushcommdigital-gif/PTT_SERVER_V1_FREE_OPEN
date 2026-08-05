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
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.Typeface
import android.location.Location
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import com.pushcomm.ptt.MapDriver
import com.pushcomm.ptt.ui.theme.ColorAccent
import com.pushcomm.ptt.ui.theme.ColorBackground
import com.pushcomm.ptt.ui.theme.ColorSurface
import com.pushcomm.ptt.ui.theme.ColorSurfaceHigh
import com.pushcomm.ptt.ui.theme.ColorTextSecondary
import com.pushcomm.ptt.viewmodel.AppViewModel
import com.pushcomm.ptt.viewmodel.MapViewModel
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

private const val SOURCE_USERS = "source-users"
private const val LAYER_USERS_SYMBOL = "layer-users-symbol"
private const val SOURCE_ME = "source-me"
private const val LAYER_ME_CIRCLE = "layer-me-circle"
private const val SOURCE_DEST = "source-dest"
private const val LAYER_DEST_CIRCLE = "layer-dest-circle"

private val OSM_RASTER_STYLE = """
{
  "version": 8,
  "sources": {
    "osm": {
      "type": "raster",
      "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      "tileSize": 256,
      "attribution": "© OpenStreetMap contributors",
      "maxzoom": 19
    }
  },
  "layers": [
    { "id": "osm-tiles", "type": "raster", "source": "osm" }
  ]
}
""".trimIndent()

@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun MapScreen(appVm: AppViewModel, mapVm: MapViewModel) {
    val session by appVm.session.collectAsState()
    val state by mapVm.state.collectAsState()
    val selectedDriverId by mapVm.selectedDriverId.collectAsState()
    val selectedDriver = state.drivers.find { it.id == selectedDriverId }
    val pendingCenter by mapVm.pendingCenter.collectAsState()
    val destinationPin by mapVm.destinationPin.collectAsState()
    val destinationSelected by mapVm.destinationSelected.collectAsState()

    val locationPermissions = rememberMultiplePermissionsState(
        permissions = listOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ),
    )

    if (!locationPermissions.allPermissionsGranted) {
        Box(
            modifier = Modifier.fillMaxSize().background(ColorBackground),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(32.dp),
            ) {
                Text(
                    "Location permission is needed to show your position on the map and report your coordinates to dispatch.",
                    color = ColorTextSecondary,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(24.dp))
                Button(
                    onClick = { locationPermissions.launchMultiplePermissionRequest() },
                    colors = ButtonDefaults.buttonColors(containerColor = ColorAccent),
                ) {
                    Text("Grant Location Permission")
                }
            }
        }
        return
    }

    val context = LocalContext.current
    val density = context.resources.displayMetrics.density
    val mapView = remember {
        MapLibre.getInstance(context)
        MapView(context).also { it.onCreate(null) }
    }
    val mapRef = remember { arrayOfNulls<MapLibreMap>(1) }
    var hasCenteredOnSelf by remember { mutableStateOf(false) }
    var hasFitVisibleUnits by remember { mutableStateOf(false) }
    // True once setStyle callback has finished adding sources/layers — guards all update effects
    var mapStyleReady by remember { mutableStateOf(false) }

    DisposableEffect(mapView) {
        mapView.onStart()
        mapView.onResume()
        onDispose {
            mapVm.stopTracking()
            mapView.onPause()
            mapView.onStop()
            mapView.onDestroy()
        }
    }

    // Guard: mapStyleReady becomes true inside the setStyle callback after sources/layers are added.
    // Using it as a key means each effect re-fires once the map is ready, even if data arrived first.

    LaunchedEffect(state.myLocation, mapStyleReady) {
        if (!mapStyleReady) return@LaunchedEffect
        val loc = state.myLocation
        updateMyLocationOnMap(mapRef[0]?.style, loc)
        if (loc != null && !hasCenteredOnSelf) {
            hasCenteredOnSelf = true
            mapRef[0]?.animateCamera(
                CameraUpdateFactory.newCameraPosition(
                    CameraPosition.Builder()
                        .target(LatLng(loc.latitude, loc.longitude))
                        .zoom(14.0)
                        .build(),
                ),
            )
        }
    }

    LaunchedEffect(state.drivers, mapStyleReady) {
        if (!mapStyleReady) return@LaunchedEffect
        updateDriversOnMap(mapRef[0]?.style, state.drivers, density)
    }

    LaunchedEffect(state.drivers, state.myLocation, mapStyleReady) {
        if (!mapStyleReady || hasFitVisibleUnits || state.drivers.isEmpty()) return@LaunchedEffect
        if (fitVisibleMapPoints(mapRef[0], state.myLocation, state.drivers)) {
            hasFitVisibleUnits = true
            hasCenteredOnSelf = true
        }
    }

    LaunchedEffect(destinationPin, mapStyleReady) {
        if (!mapStyleReady) return@LaunchedEffect
        updateDestinationOnMap(mapRef[0]?.style, destinationPin)
    }

    // External center request (e.g. tapping a location message in chat)
    LaunchedEffect(pendingCenter) {
        val target = pendingCenter ?: return@LaunchedEffect
        while (mapRef[0] == null) { kotlinx.coroutines.delay(50) }
        mapRef[0]?.animateCamera(
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder()
                    .target(LatLng(target.first, target.second))
                    .zoom(15.0)
                    .build(),
            ),
        )
        mapVm.consumeCenter()
    }

    Box(Modifier.fillMaxSize()) {
        androidx.compose.ui.viewinterop.AndroidView(
            factory = {
                mapView.apply {
                    getMapAsync { map ->
                        mapRef[0] = map
                        map.setStyle(Style.Builder().fromJson(OSM_RASTER_STYLE)) { style ->
                            style.addSource(GeoJsonSource(SOURCE_USERS))
                            style.addSource(GeoJsonSource(SOURCE_ME))
                            style.addSource(GeoJsonSource(SOURCE_DEST))

                            // Teammates — bitmap markers (per-feature iconImage). Bitmaps are
                            // generated and registered into the style by updateDriversOnMap().
                            style.addLayer(
                                SymbolLayer(LAYER_USERS_SYMBOL, SOURCE_USERS).withProperties(
                                    PropertyFactory.iconImage(Expression.get("iconId")),
                                    PropertyFactory.iconAllowOverlap(true),
                                    PropertyFactory.iconIgnorePlacement(true),
                                ),
                            )

                            style.addLayer(
                                CircleLayer(LAYER_DEST_CIRCLE, SOURCE_DEST).withProperties(
                                    PropertyFactory.circleRadius(13f),
                                    PropertyFactory.circleColor("#EF4444"),
                                    PropertyFactory.circleStrokeWidth(3f),
                                    PropertyFactory.circleStrokeColor("#FFFFFF"),
                                ),
                            )

                            // Own position — blue dot drawn last so it's never obscured.
                            style.addLayer(
                                CircleLayer(LAYER_ME_CIRCLE, SOURCE_ME).withProperties(
                                    PropertyFactory.circleRadius(15f),
                                    PropertyFactory.circleColor("#3B82F6"),
                                    PropertyFactory.circleStrokeWidth(3.5f),
                                    PropertyFactory.circleStrokeColor("#FFFFFF"),
                                ),
                            )

                            // Tap listener — destination pin first, then unit markers
                            map.addOnMapClickListener { latLng ->
                                val screen = map.projection.toScreenLocation(latLng)
                                val destHits = map.queryRenderedFeatures(
                                    PointF(screen.x, screen.y),
                                    LAYER_DEST_CIRCLE,
                                )
                                if (destHits.isNotEmpty()) {
                                    mapVm.selectDriver(null)
                                    mapVm.selectDestination()
                                    return@addOnMapClickListener true
                                }
                                val unitHits = map.queryRenderedFeatures(
                                    PointF(screen.x, screen.y),
                                    LAYER_USERS_SYMBOL,
                                )
                                if (unitHits.isNotEmpty()) {
                                    mapVm.selectDriver(unitHits[0].getStringProperty("userId"))
                                    true
                                } else {
                                    mapVm.selectDriver(null)
                                    mapVm.deselectDestination()
                                    false
                                }
                            }

                            // factory closure captures state from first composition — read live values
                            val currentState = mapVm.state.value
                            if (!hasCenteredOnSelf) {
                                val myLoc = currentState.myLocation
                                if (myLoc != null) {
                                    hasCenteredOnSelf = true
                                    map.cameraPosition = CameraPosition.Builder()
                                        .target(LatLng(myLoc.latitude, myLoc.longitude))
                                        .zoom(14.0)
                                        .build()
                                } else {
                                    val first = currentState.drivers.firstOrNull()
                                    if (first != null) {
                                        map.cameraPosition = CameraPosition.Builder()
                                            .target(LatLng(first.latitude ?: 0.0, first.longitude ?: 0.0))
                                            .zoom(12.0)
                                            .build()
                                    }
                                }
                            }
                            updateDriversOnMap(style, currentState.drivers, density)
                            updateMyLocationOnMap(style, currentState.myLocation)
                            updateDestinationOnMap(style, mapVm.destinationPin.value)
                            // Signal LaunchedEffects that sources/layers are ready
                            mapStyleReady = true
                        }
                    }
                }
            },
            modifier = Modifier.fillMaxSize(),
            update = { updateDriversOnMap(mapRef[0]?.style, state.drivers, density) },
        )

        // FAB column — bottom right
        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 16.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.End,
        ) {
            SmallFloatingActionButton(
                onClick = { mapVm.refreshNow(session.baseUrl, session.accessToken) },
                containerColor = ColorSurface,
                contentColor = Color.White,
            ) {
                Icon(Icons.Default.Refresh, contentDescription = "Refresh")
            }
            FloatingActionButton(
                onClick = {
                    state.myLocation?.let { loc ->
                        mapRef[0]?.animateCamera(
                            CameraUpdateFactory.newCameraPosition(
                                CameraPosition.Builder()
                                    .target(LatLng(loc.latitude, loc.longitude))
                                    .zoom(15.0)
                                    .build(),
                            ),
                        )
                    }
                },
                containerColor = ColorAccent,
                contentColor = Color.White,
            ) {
                Icon(Icons.Default.MyLocation, contentDescription = "My Location")
            }
        }

        // Driver count badge — top right
        if (state.drivers.isNotEmpty()) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(ColorSurface.copy(alpha = 0.9f))
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            ) {
                Text(
                    "${state.drivers.size} unit${if (state.drivers.size == 1) "" else "s"} on map",
                    color = Color.White,
                    fontSize = 11.sp,
                )
            }
        }

        // Destination card — slides up when destination pin is tapped
        AnimatedVisibility(
            visible = destinationSelected && destinationPin != null,
            enter = slideInVertically(initialOffsetY = { it }),
            exit = slideOutVertically(targetOffsetY = { it }),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            destinationPin?.let { (lat, lon) ->
                DestinationCard(
                    lat = lat,
                    lon = lon,
                    onDismiss = { mapVm.clearDestination() },
                )
            }
        }

        // Selected driver info card — slides up from bottom
        AnimatedVisibility(
            visible = selectedDriver != null,
            enter = slideInVertically(initialOffsetY = { it }),
            exit = slideOutVertically(targetOffsetY = { it }),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            selectedDriver?.let { driver ->
                DriverInfoCard(
                    driver = driver,
                    onDismiss = { mapVm.selectDriver(null) },
                    onLocate = {
                        val lat = driver.latitude ?: return@DriverInfoCard
                        val lon = driver.longitude ?: return@DriverInfoCard
                        mapRef[0]?.animateCamera(
                            CameraUpdateFactory.newCameraPosition(
                                CameraPosition.Builder()
                                    .target(LatLng(lat, lon))
                                    .zoom(16.0)
                                    .build(),
                            ),
                        )
                    },
                )
            }
        }
    }
}

@Composable
private fun DestinationCard(lat: Double, lon: Double, onDismiss: () -> Unit) {
    val context = LocalContext.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
            .background(ColorSurface)
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Column {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(androidx.compose.ui.graphics.Color(0xFFEF4444)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Default.LocationOn,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(28.dp),
                    )
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text("Shared Location", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        "${"%.5f".format(lat)}, ${"%.5f".format(lon)}",
                        color = ColorTextSecondary,
                        fontSize = 12.sp,
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = ColorTextSecondary)
                }
            }
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    val uri = Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$lat,$lon")
                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                },
                colors = ButtonDefaults.buttonColors(containerColor = androidx.compose.ui.graphics.Color(0xFFEF4444)),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.LocationOn, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("Get Directions", fontSize = 13.sp)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun DriverInfoCard(driver: MapDriver, onDismiss: () -> Unit, onLocate: () -> Unit) {
    val lastSeen = driver.lastLocationAt?.let { formatRelativeTime(it) } ?: "Unknown"
    val initials = buildString {
        driver.firstName.firstOrNull()?.let { append(it) }
        driver.lastName.firstOrNull()?.let { append(it) }
    }.ifEmpty { "?" }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
            .background(ColorSurface)
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Column {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                // Avatar
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(ColorAccent),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(initials, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }

                Spacer(Modifier.width(14.dp))

                Column(Modifier.weight(1f)) {
                    Text(
                        "${driver.firstName} ${driver.lastName}".trim(),
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        "@${driver.username}",
                        color = ColorTextSecondary,
                        fontSize = 12.sp,
                    )
                    driver.groupName?.takeIf { it.isNotBlank() }?.let { groupName ->
                        Text(
                            groupName,
                            color = ColorAccent,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                    driver.statusLabel?.takeIf { it.isNotBlank() }?.let { statusLabel ->
                        Spacer(Modifier.height(4.dp))
                        StatusPill(
                            label = statusLabel,
                            color = parseStatusColor(driver.statusColor),
                        )
                    }
                }

                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = ColorTextSecondary)
                }
            }

            Spacer(Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("Last seen", color = ColorTextSecondary, fontSize = 11.sp)
                    Text(lastSeen, color = Color.White, fontSize = 13.sp)
                    if (driver.latitude != null && driver.longitude != null) {
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "${"%.5f".format(driver.latitude)}, ${"%.5f".format(driver.longitude)}",
                            color = ColorTextSecondary,
                            fontSize = 10.sp,
                        )
                    }
                }

                Button(
                    onClick = onLocate,
                    colors = ButtonDefaults.buttonColors(containerColor = ColorAccent),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Icon(Icons.Default.MyLocation, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Locate", fontSize = 13.sp)
                }
            }

            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun StatusPill(label: String, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(color.copy(alpha = 0.18f))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(color),
            )
            Spacer(Modifier.width(5.dp))
            Text(
                label,
                color = color,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

private fun formatRelativeTime(isoString: String): String {
    return try {
        val then = Instant.parse(isoString)
        val now = Instant.now()
        val minutes = ChronoUnit.MINUTES.between(then, now)
        when {
            minutes < 1 -> "Just now"
            minutes < 60 -> "$minutes min ago"
            minutes < 1440 -> "${minutes / 60}h ago"
            else -> DateTimeFormatter.ofPattern("MMM d, HH:mm")
                .withZone(ZoneId.systemDefault())
                .format(then)
        }
    } catch (_: Exception) {
        isoString
    }
}

private fun parseStatusColor(hex: String?): Color {
    return try {
        if (hex.isNullOrBlank()) ColorTextSecondary else Color(AndroidColor.parseColor(hex))
    } catch (_: Exception) {
        ColorTextSecondary
    }
}

private fun updateMyLocationOnMap(style: Style?, location: Location?) {
    val source = style?.getSourceAs<GeoJsonSource>(SOURCE_ME) ?: return
    if (location == null) {
        source.setGeoJson(FeatureCollection.fromFeatures(emptyList()))
        return
    }
    val feature = Feature.fromGeometry(Point.fromLngLat(location.longitude, location.latitude)).also { feat ->
        feat.addStringProperty("label", "ME")
    }
    source.setGeoJson(FeatureCollection.fromFeatures(listOf(feature)))
}

private fun updateDestinationOnMap(style: Style?, dest: Pair<Double, Double>?) {
    val source = style?.getSourceAs<GeoJsonSource>(SOURCE_DEST) ?: return
    if (dest == null) {
        source.setGeoJson(FeatureCollection.fromFeatures(emptyList()))
        return
    }
    val feature = Feature.fromGeometry(Point.fromLngLat(dest.second, dest.first))
    source.setGeoJson(FeatureCollection.fromFeatures(listOf(feature)))
}

private fun updateDriversOnMap(style: Style?, drivers: List<MapDriver>, density: Float) {
    val source = style?.getSourceAs<GeoJsonSource>(SOURCE_USERS) ?: return

    val features = drivers.mapNotNull { driver ->
        val lat = driver.latitude ?: return@mapNotNull null
        val lon = driver.longitude ?: return@mapNotNull null
        val label = unitMarkerLabel(driver)
        val iconId = "user-${driver.id}-$label"
        // addImage is idempotent — overwriting on each refresh is harmless.
        style.addImage(iconId, renderUnitMarkerBitmap(label, density))
        Feature.fromGeometry(Point.fromLngLat(lon, lat)).also { feat ->
            feat.addStringProperty("name", "${driver.firstName} ${driver.lastName}".trim())
            feat.addStringProperty("label", label)
            feat.addStringProperty("userId", driver.id)
            feat.addStringProperty("groupName", driver.groupName ?: "")
            feat.addStringProperty("iconId", iconId)
        }
    }

    source.setGeoJson(FeatureCollection.fromFeatures(features))
}

private fun fitVisibleMapPoints(
    map: MapLibreMap?,
    myLocation: Location?,
    drivers: List<MapDriver>,
): Boolean {
    val points = mutableListOf<LatLng>()
    myLocation?.let { points.add(LatLng(it.latitude, it.longitude)) }
    drivers.forEach { driver ->
        val lat = driver.latitude
        val lon = driver.longitude
        if (lat != null && lon != null) {
            points.add(LatLng(lat, lon))
        }
    }

    val targetMap = map ?: return false
    if (points.isEmpty()) return false

    if (points.size == 1) {
        targetMap.animateCamera(
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder()
                    .target(points.first())
                    .zoom(15.0)
                    .build(),
            ),
        )
        return true
    }

    val boundsBuilder = LatLngBounds.Builder()
    points.forEach { boundsBuilder.include(it) }
    val bounds = boundsBuilder.build()
    if (bounds.latitudeSpan < 0.01 && bounds.longitudeSpan < 0.01) {
        val midLat = (bounds.northEast.latitude + bounds.southWest.latitude) / 2.0
        val midLon = (bounds.northEast.longitude + bounds.southWest.longitude) / 2.0
        targetMap.animateCamera(
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder().target(LatLng(midLat, midLon)).zoom(14.0).build(),
            ),
        )
    } else {
        targetMap.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, 120))
    }
    return true
}

private fun renderUnitMarkerBitmap(label: String, density: Float): Bitmap {
    val sizePx = (32f * density).toInt().coerceAtLeast(48)
    val bm = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val c = Canvas(bm)
    val cx = sizePx / 2f
    val cy = sizePx / 2f
    val strokePx = 3.5f * density
    val radius = cx - strokePx / 2f

    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = AndroidColor.parseColor("#16A34A")
        style = Paint.Style.FILL
    }
    val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = AndroidColor.WHITE
        style = Paint.Style.STROKE
        strokeWidth = strokePx
    }
    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = AndroidColor.WHITE
        textAlign = Paint.Align.CENTER
        textSize = 11f * density
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }

    c.drawCircle(cx, cy, radius, fill)
    c.drawCircle(cx, cy, radius, stroke)
    val baseline = cy - (text.descent() + text.ascent()) / 2f
    c.drawText(label, cx, baseline, text)
    return bm
}

private fun unitMarkerLabel(driver: MapDriver): String {
    val source = when {
        driver.username.isNotBlank() -> driver.username
        driver.firstName.isNotBlank() || driver.lastName.isNotBlank() -> "${driver.firstName} ${driver.lastName}"
        else -> "U"
    }
    val number = Regex("(\\d+)$").find(source)?.groupValues?.getOrNull(1)
    if (number != null) return "U${number.padStart(2, '0')}"

    val initials = buildString {
        source.split(Regex("\\s+|[_\\-.]+"))
            .filter { it.isNotBlank() }
            .take(2)
            .forEach { append(it.first().uppercaseChar()) }
    }
    return initials.ifBlank { "U" }.take(3)
}
