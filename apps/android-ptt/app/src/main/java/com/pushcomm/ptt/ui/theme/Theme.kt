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
package com.pushcomm.ptt.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Typography

// ── Palette ────────────────────────────────────────────────────────────────
val ColorBackground   = Color(0xFF1A1D23)
val ColorSurface      = Color(0xFF242830)
val ColorSurfaceHigh  = Color(0xFF2E3340)
val ColorSidebar      = Color(0xFF141720)
val ColorAccent       = Color(0xFFE67E22)
val ColorAccentDark   = Color(0xFFCF6D17)
val ColorTextPrimary  = Color(0xFFECEFF4)
val ColorTextSecondary = Color(0xFF8892A4)
val ColorOnline       = Color(0xFF2ECC71)
val ColorError        = Color(0xFFE74C3C)
val ColorWarning      = Color(0xFFF39C12)

private val DarkColors = darkColorScheme(
    primary          = ColorAccent,
    onPrimary        = Color.White,
    primaryContainer = ColorAccentDark,
    secondary        = ColorSurfaceHigh,
    onSecondary      = ColorTextPrimary,
    background       = ColorBackground,
    onBackground     = ColorTextPrimary,
    surface          = ColorSurface,
    onSurface        = ColorTextPrimary,
    surfaceVariant   = ColorSurfaceHigh,
    onSurfaceVariant = ColorTextSecondary,
    error            = ColorError,
    onError          = Color.White,
)

private val AppTypography = Typography(
    titleLarge  = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold,   color = ColorTextPrimary),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = ColorTextPrimary),
    bodyLarge   = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Normal, color = ColorTextPrimary),
    bodyMedium  = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Normal, color = ColorTextPrimary),
    bodySmall   = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Normal, color = ColorTextSecondary),
    labelSmall  = TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Medium, color = ColorTextSecondary),
)

@Composable
fun PushcommTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColors,
        typography  = AppTypography,
        content     = content,
    )
}
