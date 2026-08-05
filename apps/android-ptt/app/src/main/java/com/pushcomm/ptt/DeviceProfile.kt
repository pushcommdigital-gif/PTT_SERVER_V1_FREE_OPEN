package com.pushcomm.ptt

/**
 * Which device profile this build targets.
 *
 * Community Edition ships one flavor: `smartphone`. The commercial build adds
 * OEM kiosk flavors (rugged PTT handsets with hardware PTT/SOS keys and
 * Device-Owner lock-task) via its own flavors and source sets; this object is
 * the seam they extend, which is why the lookups stay `when`-shaped rather than
 * collapsing to constants.
 */
object DeviceProfile {
    const val SMARTPHONE = "smartphone"

    val current: String = BuildConfig.DEVICE_PROFILE
    val isSmartphone: Boolean = current == SMARTPHONE

    val displayName: String = when (current) {
        SMARTPHONE -> "Smartphone"
        else -> "Android"
    }
}
