plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.plugin.compose")
}

// Firebase Cloud Messaging is optional and per-deployment: `google-services.json`
// comes from YOUR Firebase project and is not in this repository (it is not a
// secret, but it is deployment-specific — see app/google-services.json.example).
// Apply the plugin only when the file is present so a fresh clone builds and
// runs out of the box; without it the app works, minus push wake-ups.
val hasGoogleServices = file("google-services.json").exists()
if (hasGoogleServices) {
  apply(plugin = "com.google.gms.google-services")
} else {
  logger.lifecycle(
    "[pushcomm] app/google-services.json not found — building without Firebase. " +
      "Push notifications (incoming call/message/SOS wake-ups) will be inactive.",
  )
}

android {
  namespace = "com.pushcomm.ptt"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.pushcomm.ptt"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "1.0.0"
  }

  // Community Edition ships the `smartphone` flavor only. OEM kiosk flavors
  // (Device-Owner lock-task, hardware PTT/SOS keys) are part of the commercial
  // build and add their own flavors + source sets here.
  flavorDimensions += "deviceProfile"
  productFlavors {
    create("smartphone") {
      dimension = "deviceProfile"
      buildConfigField("String", "DEVICE_PROFILE", "\"smartphone\"")
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro",
      )
    }
  }

  // compileOptions and kotlinOptions replaced by jvmToolchain below
  kotlin {
    jvmToolchain(17)
  }

  buildFeatures {
    buildConfig = true
    viewBinding = false
    compose = true
  }

  // composeOptions block removed — Compose compiler is now part of
  // the org.jetbrains.kotlin.plugin.compose plugin (Kotlin 2.x)
}

dependencies {
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("com.squareup.moshi:moshi-kotlin:1.15.1")
  implementation("io.livekit:livekit-android:2.8.1")

  // Jetpack Compose
  implementation(platform("androidx.compose:compose-bom:2024.09.00"))
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.activity:activity-compose:1.9.2")
  implementation("androidx.navigation:navigation-compose:2.8.3")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")

  // Firebase (FCM push notifications)
  implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
  implementation("com.google.firebase:firebase-messaging-ktx")

  // Location (GPS)
  implementation("com.google.android.gms:play-services-location:21.3.0")

  // MapLibre (map view)
  implementation("org.maplibre.gl:android-sdk:11.5.1")

  // Image loading for chat attachments
  implementation("io.coil-kt:coil-compose:2.7.0")

  // Runtime permissions helper
  implementation("com.google.accompanist:accompanist-permissions:0.37.3")

  // QR provisioning scanner
  implementation("com.journeyapps:zxing-android-embedded:4.3.0")

  debugImplementation("androidx.compose.ui:ui-tooling")
}
