package com.machine.voice.ui.notifications

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.machine.voice.data.local.AppRuleEntity
import com.machine.voice.data.local.ContactPriority
import com.machine.voice.data.local.ContactRuleEntity
import com.machine.voice.data.local.NotificationLogEntity
import com.machine.voice.data.prefs.OwnerSettings
import com.machine.voice.ui.theme.AmberWarning
import com.machine.voice.ui.theme.ChampagneGold
import com.machine.voice.ui.theme.CharcoalPanel
import com.machine.voice.ui.theme.CrimsonAlert
import com.machine.voice.ui.theme.EmeraldGranted
import com.machine.voice.ui.theme.GoldBorder
import com.machine.voice.ui.theme.IvoryText
import com.machine.voice.ui.theme.MetallicGold
import com.machine.voice.ui.theme.MutedIvory
import com.machine.voice.ui.theme.ObsidianBlack
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun NotificationsFeedScreen(
    notifications: List<NotificationLogEntity>,
    listenerGranted: Boolean,
    isSpeaking: Boolean,
    queueSize: Int,
    settings: OwnerSettings,
    onOpenListenerSettings: () -> Unit,
    onReadFull: (NotificationLogEntity) -> Unit,
    onStopSpeech: () -> Unit,
    onTestSpeech: () -> Unit,
    onSetContactPriority: (sender: String, priority: ContactPriority) -> Unit,
    onClearNotifications: () -> Unit
) {
    val timeFormatter = remember { SimpleDateFormat("HH:mm", Locale.getDefault()) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ObsidianBlack)
            .padding(horizontal = 20.dp, vertical = 14.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = "SPOKEN INBOX", style = MaterialTheme.typography.headlineSmall)
                Text(
                    text = if (isSpeaking) {
                        "SPEAKING · QUEUE: $queueSize"
                    } else if (settings.headphoneOnlyMode) {
                        "PRIVACY MODE: HEADPHONES / BT ONLY"
                    } else {
                        "AUTO-RETENTION: ${settings.retentionWindow.labelEn.uppercase()}"
                    },
                    style = MaterialTheme.typography.labelSmall.copy(
                        color = if (isSpeaking) EmeraldGranted else MetallicGold
                    )
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (isSpeaking) {
                    Button(
                        onClick = onStopSpeech,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = CrimsonAlert,
                            contentColor = IvoryText
                        ),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("STOP")
                    }
                } else {
                    OutlinedButton(
                        onClick = onTestSpeech,
                        border = BorderStroke(1.dp, MetallicGold),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("TEST TTS", color = MetallicGold)
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(10.dp))
        HorizontalDivider(color = GoldBorder)
        Spacer(modifier = Modifier.height(12.dp))

        if (!listenerGranted) {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, CrimsonAlert),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "NOTIFICATION ACCESS MISSING",
                        style = MaterialTheme.typography.titleMedium.copy(color = CrimsonAlert)
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Enable Machine Voice Reader in Android Notification Access to hear incoming WhatsApp, SMS, Gmail, and M-Pesa alerts.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Button(
                        onClick = onOpenListenerSettings,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MetallicGold,
                            contentColor = ObsidianBlack
                        ),
                        modifier = Modifier.fillMaxWidth().height(46.dp)
                    ) {
                        Text("ENABLE NOTIFICATION ACCESS", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
        }

        if (notifications.isEmpty()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("NO RECENT MESSAGES", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        "Incoming notifications from enabled apps will appear here and be spoken through the queued TTS engine. OTP codes and card numbers are automatically shielded.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(notifications, key = { it.id }) { item ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                        border = BorderStroke(
                            1.dp,
                            if (item.isVip) ChampagneGold else GoldBorder
                        ),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "${item.sender} · ${item.appName}",
                                    style = MaterialTheme.typography.bodyLarge.copy(
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (item.isVip) ChampagneGold else IvoryText
                                    ),
                                    modifier = Modifier.weight(1f)
                                )
                                Text(
                                    text = "${timeFormatter.format(Date(item.receivedAt))} · ${item.languageCode.uppercase()}",
                                    style = MaterialTheme.typography.labelSmall
                                )
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = item.fullText,
                                style = MaterialTheme.typography.bodyMedium.copy(
                                    color = if (item.isSensitiveShielded) AmberWarning else IvoryText
                                )
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Button(
                                    onClick = { onReadFull(item) },
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = MetallicGold,
                                        contentColor = ObsidianBlack
                                    ),
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.weight(1f).height(40.dp)
                                ) {
                                    Text("READ", style = MaterialTheme.typography.labelLarge)
                                }
                                OutlinedButton(
                                    onClick = {
                                        val next = if (item.isVip) ContactPriority.NORMAL else ContactPriority.VIP
                                        onSetContactPriority(item.sender, next)
                                    },
                                    border = BorderStroke(1.dp, GoldBorder),
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.height(40.dp)
                                ) {
                                    Text(
                                        text = if (item.isVip) "VIP ✓" else "VIP",
                                        color = ChampagneGold
                                    )
                                }
                                OutlinedButton(
                                    onClick = { onSetContactPriority(item.sender, ContactPriority.SILENT) },
                                    border = BorderStroke(1.dp, GoldBorder),
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.height(40.dp)
                                ) {
                                    Text("MUTE", color = MutedIvory)
                                }
                            }
                        }
                    }
                }
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedButton(
                        onClick = onClearNotifications,
                        border = BorderStroke(1.dp, CrimsonAlert),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("CLEAR MESSAGE HISTORY", color = CrimsonAlert)
                    }
                }
            }
        }
    }
}

@Composable
fun NotificationRulesScreen(
    settings: OwnerSettings,
    appRules: List<AppRuleEntity>,
    contactRules: List<ContactRuleEntity>,
    onToggleReaderEnabled: (Boolean) -> Unit,
    onToggleHeadphoneOnly: (Boolean) -> Unit,
    onToggleIgnoreGroups: (Boolean) -> Unit,
    onToggleIgnoreMuted: (Boolean) -> Unit,
    onToggleQuietHours: (Boolean) -> Unit,
    onUpdateVoiceTuning: (rate: Float, pitch: Float) -> Unit,
    onToggleAppRule: (packageName: String, enabled: Boolean) -> Unit,
    onUpsertContactRule: (name: String, priority: ContactPriority) -> Unit,
    onDeleteContactRule: (senderKey: String) -> Unit
) {
    var newContactName by remember { mutableStateOf("") }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(ObsidianBlack)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text(text = "READER & VOICE RULES", style = MaterialTheme.typography.headlineSmall)
            Text(
                text = "Choose which apps speak, privacy shields, quiet hours, and VIP contacts.",
                style = MaterialTheme.typography.bodyMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            HorizontalDivider(color = GoldBorder)
        }

        // Privacy & filtering toggles
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("PRIVACY & FILTERING", style = MaterialTheme.typography.titleMedium)

                    RuleSwitchRow(
                        label = "Speak Incoming Notifications",
                        checked = settings.notificationReaderEnabled,
                        onCheckedChange = onToggleReaderEnabled
                    )
                    RuleSwitchRow(
                        label = "Headphones / Bluetooth Only",
                        checked = settings.headphoneOnlyMode,
                        onCheckedChange = onToggleHeadphoneOnly
                    )
                    RuleSwitchRow(
                        label = "Ignore Group Conversations",
                        checked = settings.ignoreGroups,
                        onCheckedChange = onToggleIgnoreGroups
                    )
                    RuleSwitchRow(
                        label = "Ignore Muted / Low-Priority Channels",
                        checked = settings.ignoreMuted,
                        onCheckedChange = onToggleIgnoreMuted
                    )
                    RuleSwitchRow(
                        label = "Quiet Hours (${settings.quietHoursStart} – ${settings.quietHoursEnd})",
                        checked = settings.quietHoursEnabled,
                        onCheckedChange = onToggleQuietHours
                    )
                }
            }
        }

        // TTS speed & pitch
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("TEXT-TO-SPEECH VOICE", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Speed: ${"%.1f".format(settings.voiceRate)}x",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Slider(
                        value = settings.voiceRate,
                        onValueChange = { onUpdateVoiceTuning(it, settings.voicePitch) },
                        valueRange = 0.6f..1.6f,
                        colors = SliderDefaults.colors(
                            thumbColor = ChampagneGold,
                            activeTrackColor = MetallicGold
                        )
                    )
                    Text(
                        text = "Pitch: ${"%.1f".format(settings.voicePitch)}x",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Slider(
                        value = settings.voicePitch,
                        onValueChange = { onUpdateVoiceTuning(settings.voiceRate, it) },
                        valueRange = 0.7f..1.4f,
                        colors = SliderDefaults.colors(
                            thumbColor = ChampagneGold,
                            activeTrackColor = MetallicGold
                        )
                    )
                }
            }
        }

        // Contact VIP / Silent rules
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("VIP & SILENT CONTACTS", style = MaterialTheme.typography.titleMedium)
                    OutlinedTextField(
                        value = newContactName,
                        onValueChange = { newContactName = it },
                        label = { Text("Sender / Contact Name", color = MutedIvory) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = MetallicGold,
                            unfocusedBorderColor = GoldBorder,
                            focusedTextColor = IvoryText,
                            unfocusedTextColor = IvoryText
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = {
                                val trimmed = newContactName.trim()
                                if (trimmed.isNotEmpty()) {
                                    onUpsertContactRule(trimmed, ContactPriority.VIP)
                                    newContactName = ""
                                }
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MetallicGold,
                                contentColor = ObsidianBlack
                            ),
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("ADD VIP")
                        }
                        OutlinedButton(
                            onClick = {
                                val trimmed = newContactName.trim()
                                if (trimmed.isNotEmpty()) {
                                    onUpsertContactRule(trimmed, ContactPriority.SILENT)
                                    newContactName = ""
                                }
                            },
                            border = BorderStroke(1.dp, GoldBorder),
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("ADD SILENT", color = IvoryText)
                        }
                    }

                    contactRules.forEach { rule ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "${rule.displayName} (${rule.priority})",
                                style = MaterialTheme.typography.bodyLarge.copy(
                                    color = if (rule.priority == ContactPriority.VIP.name) ChampagneGold else MutedIvory
                                ),
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedButton(
                                onClick = { onDeleteContactRule(rule.senderKey) },
                                border = BorderStroke(1.dp, GoldBorder)
                            ) {
                                Text("REMOVE", color = CrimsonAlert)
                            }
                        }
                    }
                }
            }
        }

        // Per-app rules list
        item {
            Text("ALLOWED APPS", style = MaterialTheme.typography.titleMedium)
        }
        items(appRules, key = { it.packageName }) { rule ->
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f).padding(end = 10.dp)) {
                        Text(
                            text = rule.appLabel,
                            style = MaterialTheme.typography.bodyLarge
                        )
                        Text(
                            text = "${rule.category} · ${rule.packageName}",
                            style = MaterialTheme.typography.labelSmall.copy(color = MutedIvory)
                        )
                    }
                    Switch(
                        checked = rule.enabled,
                        onCheckedChange = { onToggleAppRule(rule.packageName, it) },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = ObsidianBlack,
                            checkedTrackColor = MetallicGold
                        )
                    )
                }
            }
        }
    }
}

@Composable
private fun RuleSwitchRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f).padding(end = 12.dp)
        )
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = ObsidianBlack,
                checkedTrackColor = MetallicGold,
                uncheckedThumbColor = IvoryText,
                uncheckedTrackColor = ObsidianBlack
            )
        )
    }
}
