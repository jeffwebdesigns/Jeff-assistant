package com.machine.voice.ui.onboarding

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.OwnerSettings
import com.machine.voice.permissions.PermissionSnapshot
import com.machine.voice.ui.MachineStrings
import com.machine.voice.ui.permissions.PermissionChecklistContent
import com.machine.voice.ui.theme.ChampagneGold
import com.machine.voice.ui.theme.CharcoalPanel
import com.machine.voice.ui.theme.GoldBorder
import com.machine.voice.ui.theme.IvoryText
import com.machine.voice.ui.theme.MetallicGold
import com.machine.voice.ui.theme.ObsidianBlack

@Composable
fun OnboardingScreen(
    settings: OwnerSettings,
    permissionSnapshot: PermissionSnapshot,
    strings: MachineStrings,
    onSelectLanguage: (AppLanguage) -> Unit,
    onToggleAiEnabled: (Boolean) -> Unit,
    onRequestRuntimePermissions: () -> Unit,
    onOpenNotificationListener: () -> Unit,
    onOpenOverlaySettings: () -> Unit,
    onOpenBatterySettings: () -> Unit,
    onOpenSamsungAppInfo: () -> Unit,
    onOpenExactAlarmSettings: () -> Unit,
    onRequestCallScreeningRole: () -> Unit,
    onCompleteOnboarding: () -> Unit
) {
    var step by rememberSaveable { mutableIntStateOf(0) }
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ObsidianBlack)
            .safeDrawingPadding()
            .padding(horizontal = 20.dp, vertical = 16.dp)
    ) {
        Text(
            text = strings.appTitle,
            style = MaterialTheme.typography.displaySmall
        )
        Text(
            text = strings.subtitle,
            style = MaterialTheme.typography.labelSmall
        )
        Spacer(modifier = Modifier.height(12.dp))
        HorizontalDivider(color = GoldBorder)
        Spacer(modifier = Modifier.height(16.dp))

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(scrollState),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (step == 0) {
                // Language selector
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    AppLanguage.entries.forEach { lang ->
                        val selected = settings.language == lang
                        OutlinedButton(
                            onClick = { onSelectLanguage(lang) },
                            border = BorderStroke(
                                1.dp,
                                if (selected) ChampagneGold else GoldBorder
                            ),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (selected) CharcoalPanel else ObsidianBlack,
                                contentColor = if (selected) ChampagneGold else IvoryText
                            ),
                            modifier = Modifier.weight(1f).height(46.dp)
                        ) {
                            Text(text = lang.label)
                        }
                    }
                }

                // Privacy & single-owner pledge
                Card(
                    colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                    border = BorderStroke(1.dp, GoldBorder),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = strings.privacyHeadline,
                            style = MaterialTheme.typography.titleMedium
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = strings.privacyBody,
                            style = MaterialTheme.typography.bodyLarge
                        )
                    }
                }

                // Gemini Disclosure + On-Device Mode Switch
                Card(
                    colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                    border = BorderStroke(1.dp, GoldBorder),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = strings.aiDisclosureTitle,
                            style = MaterialTheme.typography.titleMedium
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = strings.aiDisclosureBody,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Spacer(modifier = Modifier.height(14.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = if (settings.aiEnabled) {
                                    strings.geminiOptInToggle
                                } else {
                                    strings.onDeviceOnlyToggle
                                },
                                style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier.weight(1f).padding(end = 12.dp)
                            )
                            Switch(
                                checked = settings.aiEnabled,
                                onCheckedChange = onToggleAiEnabled,
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = ObsidianBlack,
                                    checkedTrackColor = MetallicGold,
                                    uncheckedThumbColor = IvoryText,
                                    uncheckedTrackColor = ObsidianBlack
                                )
                            )
                        }
                    }
                }
            } else {
                Text(
                    text = strings.permissionsHeadline,
                    style = MaterialTheme.typography.headlineSmall
                )
                Text(
                    text = strings.permissionsSubtitle,
                    style = MaterialTheme.typography.bodyMedium
                )

                PermissionChecklistContent(
                    snapshot = permissionSnapshot,
                    strings = strings,
                    onRequestRuntimePermissions = onRequestRuntimePermissions,
                    onOpenNotificationListener = onOpenNotificationListener,
                    onOpenOverlaySettings = onOpenOverlaySettings,
                    onOpenBatterySettings = onOpenBatterySettings,
                    onOpenSamsungAppInfo = onOpenSamsungAppInfo,
                    onOpenExactAlarmSettings = onOpenExactAlarmSettings,
                    onRequestCallScreeningRole = onRequestCallScreeningRole
                )
            }
        }

        Spacer(modifier = Modifier.height(14.dp))

        if (step == 0) {
            Button(
                onClick = { step = 1 },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MetallicGold,
                    contentColor = ObsidianBlack
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().height(52.dp)
            ) {
                Text(text = strings.continueAction, style = MaterialTheme.typography.labelLarge)
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = { step = 0 },
                    border = BorderStroke(1.dp, MetallicGold),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.weight(1f).height(52.dp)
                ) {
                    Text(text = strings.backAction, color = MetallicGold)
                }
                Button(
                    onClick = onCompleteOnboarding,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MetallicGold,
                        contentColor = ObsidianBlack
                    ),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.weight(2f).height(52.dp)
                ) {
                    Text(
                        text = strings.finishSetupAction,
                        style = MaterialTheme.typography.labelLarge
                    )
                }
            }
        }
    }
}
