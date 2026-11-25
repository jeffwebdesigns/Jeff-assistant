package com.machine.voice.ui.permissions

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.machine.voice.permissions.PermissionSnapshot
import com.machine.voice.ui.MachineStrings
import com.machine.voice.ui.theme.AmberWarning
import com.machine.voice.ui.theme.CharcoalPanel
import com.machine.voice.ui.theme.CrimsonAlert
import com.machine.voice.ui.theme.EmeraldGranted
import com.machine.voice.ui.theme.GoldBorder
import com.machine.voice.ui.theme.IvoryText
import com.machine.voice.ui.theme.MetallicGold
import com.machine.voice.ui.theme.ObsidianBlack

@Composable
fun PermissionChecklistContent(
    snapshot: PermissionSnapshot,
    strings: MachineStrings,
    onRequestRuntimePermissions: () -> Unit,
    onOpenNotificationListener: () -> Unit,
    onOpenOverlaySettings: () -> Unit,
    onOpenBatterySettings: () -> Unit,
    onOpenSamsungAppInfo: () -> Unit,
    onOpenExactAlarmSettings: () -> Unit,
    onRequestCallScreeningRole: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        val runtimeAllGranted = snapshot.postNotifications &&
            snapshot.phoneAndCalls &&
            snapshot.contacts &&
            snapshot.callLog &&
            snapshot.microphone &&
            snapshot.bluetoothConnect

        PermissionRowCard(
            title = "Phone, Contacts, Call Log, Mic & Alerts",
            explanation = "Needed to announce incoming callers locally, hear voice commands, check Bluetooth headphones, and show service alerts.",
            granted = runtimeAllGranted,
            required = true,
            actionLabel = strings.grantButton,
            strings = strings,
            onClick = onRequestRuntimePermissions
        )

        PermissionRowCard(
            title = "Notification Reader Access",
            explanation = "Allows Machine Voice to read WhatsApp, SMS, Gmail, M-Pesa, and banking alerts aloud locally. OTP codes are never spoken.",
            granted = snapshot.notificationListener,
            required = true,
            actionLabel = strings.openSettingsButton,
            strings = strings,
            onClick = onOpenNotificationListener
        )

        PermissionRowCard(
            title = "Battery: Unrestricted (Samsung A06)",
            explanation = "Prevents Samsung One UI from stopping the notification reader and alarm alerts while the screen is off.",
            granted = snapshot.batteryUnrestricted,
            required = true,
            actionLabel = strings.openSettingsButton,
            strings = strings,
            onClick = onOpenBatterySettings
        )

        PermissionRowCard(
            title = "Display Over Other Apps (Overlay)",
            explanation = "Shows the gold incoming-caller card with contact tags and the floating voice mic button.",
            granted = snapshot.overlay,
            required = false,
            actionLabel = strings.openSettingsButton,
            strings = strings,
            onClick = onOpenOverlaySettings
        )

        PermissionRowCard(
            title = "Exact Alarms & Reminders",
            explanation = "Triggers spoken 1-day, 1-hour, 10-minute, and start-time alerts reliably even when the app is closed.",
            granted = snapshot.exactAlarm,
            required = false,
            actionLabel = strings.openSettingsButton,
            strings = strings,
            onClick = onOpenExactAlarmSettings
        )

        PermissionRowCard(
            title = "Caller ID & Spam Screening Role",
            explanation = "Lets Machine Voice silence or reject numbers you personally marked as spam on this phone.",
            granted = snapshot.callScreeningRole,
            required = false,
            actionLabel = strings.grantButton,
            strings = strings,
            onClick = onRequestCallScreeningRole
        )

        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = strings.samsungGuideTitle,
                    style = MaterialTheme.typography.titleMedium
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = strings.samsungGuideSteps,
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedButton(
                    onClick = onOpenSamsungAppInfo,
                    border = BorderStroke(1.dp, MetallicGold),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "OPEN APP INFO (BATTERY & PERMISSIONS)",
                        color = MetallicGold,
                        style = MaterialTheme.typography.labelLarge
                    )
                }
            }
        }
    }
}

@Composable
private fun PermissionRowCard(
    title: String,
    explanation: String,
    granted: Boolean,
    required: Boolean,
    actionLabel: String,
    strings: MachineStrings,
    onClick: () -> Unit
) {
    val badgeColor = when {
        granted -> EmeraldGranted
        required -> CrimsonAlert
        else -> AmberWarning
    }
    val badgeText = when {
        granted -> strings.grantedBadge
        required -> strings.missingBadge
        else -> strings.optionalBadge
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
        border = BorderStroke(1.dp, if (granted) GoldBorder else MetallicGold.copy(alpha = 0.55f)),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyLarge.copy(
                        fontWeight = FontWeight.SemiBold,
                        color = IvoryText
                    ),
                    modifier = Modifier.weight(1f).padding(end = 8.dp)
                )
                Text(
                    text = badgeText,
                    style = MaterialTheme.typography.labelSmall.copy(color = badgeColor)
                )
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = explanation,
                style = MaterialTheme.typography.bodyMedium
            )
            if (!granted) {
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onClick,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MetallicGold,
                        contentColor = ObsidianBlack
                    ),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(46.dp)
                ) {
                    Text(
                        text = actionLabel,
                        style = MaterialTheme.typography.labelLarge
                    )
                }
            }
        }
    }
}
