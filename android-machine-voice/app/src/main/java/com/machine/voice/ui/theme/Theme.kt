package com.machine.voice.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val MachineColorScheme = darkColorScheme(
    primary = MetallicGold,
    onPrimary = ObsidianBlack,
    primaryContainer = CharcoalPanel,
    onPrimaryContainer = ChampagneGold,
    secondary = ChampagneGold,
    onSecondary = ObsidianBlack,
    background = ObsidianBlack,
    onBackground = IvoryText,
    surface = ObsidianElevated,
    onSurface = IvoryText,
    surfaceVariant = CharcoalPanel,
    onSurfaceVariant = MutedIvory,
    outline = GoldBorder,
    error = CrimsonAlert,
    onError = IvoryText
)

@Composable
fun MachineVoiceTheme(content: @Composable () -> Unit) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = ObsidianBlack.toArgb()
            window.navigationBarColor = ObsidianBlack.toArgb()
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = false
            controller.isAppearanceLightNavigationBars = false
        }
    }

    MaterialTheme(
        colorScheme = MachineColorScheme,
        typography = MachineTypography,
        content = content
    )
}
