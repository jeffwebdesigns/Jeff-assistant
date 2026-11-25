package com.machine.voice.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Classical Cinzel-inspired engraved serif styling without external binary font dependencies.
// Replace FontFamily.Serif with FontFamily(Font(R.font.cinzel_semibold)) if bundling custom Cinzel TTFs.
val CinzelLikeFamily = FontFamily.Serif
val BodySansFamily = FontFamily.SansSerif

val MachineTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = CinzelLikeFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
        letterSpacing = 2.0.sp,
        color = ChampagneGold
    ),
    headlineMedium = TextStyle(
        fontFamily = CinzelLikeFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = 1.6.sp,
        color = ChampagneGold
    ),
    headlineSmall = TextStyle(
        fontFamily = CinzelLikeFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 18.sp,
        lineHeight = 24.sp,
        letterSpacing = 1.2.sp,
        color = IvoryText
    ),
    titleMedium = TextStyle(
        fontFamily = CinzelLikeFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 20.sp,
        letterSpacing = 1.0.sp,
        color = MetallicGold
    ),
    bodyLarge = TextStyle(
        fontFamily = BodySansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        color = IvoryText
    ),
    bodyMedium = TextStyle(
        fontFamily = BodySansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 19.sp,
        color = MutedIvory
    ),
    labelLarge = TextStyle(
        fontFamily = BodySansFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        letterSpacing = 0.8.sp,
        color = ObsidianBlack
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        letterSpacing = 0.8.sp,
        color = MetallicGold
    )
)
