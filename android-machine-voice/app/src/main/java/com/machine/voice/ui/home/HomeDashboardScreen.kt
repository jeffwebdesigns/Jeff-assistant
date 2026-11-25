package com.machine.voice.ui.home

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.OwnerSettings
import com.machine.voice.permissions.PermissionSnapshot
import com.machine.voice.ui.MachineStrings
import com.machine.voice.ui.theme.AmberWarning
import com.machine.voice.ui.theme.ChampagneGold
import com.machine.voice.ui.theme.CharcoalPanel
import com.machine.voice.ui.theme.CrimsonAlert
import com.machine.voice.ui.theme.EmeraldGranted
import com.machine.voice.ui.theme.GoldBorder
import com.machine.voice.ui.theme.IvoryText
import com.machine.voice.ui.theme.MetallicGold
import com.machine.voice.ui.theme.ObsidianBlack

@Composable
fun HomeDashboardScreen(
    settings: OwnerSettings,
    permissionSnapshot: PermissionSnapshot,
    keepAliveRunning: Boolean,
    recentNotificationCount: Int,
    activeReminderCount: Int,
    overdueReminderCount: Int,
    isSpeaking: Boolean,
    strings: MachineStrings,
    onToggleKeepAlive: () -> Unit,
    onOpenVoice: () -> Unit,
    onOpenBriefing: () -> Unit,
    onPlayBriefing: () -> Unit,
    onOpenReminders: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenRules: () -> Unit,
    onOpenPermissions: () -> Unit,
    onOpenSettings: () -> Unit,
    onStopSpeech: () -> Unit,
    onToggleLanguage: () -> Unit,
    onReviewOnboarding: () -> Unit
) {
    val scrollState = rememberScrollState()
    val coreRatio = permissionSnapshot.coreReadyCount.toFloat() / permissionSnapshot.coreTotalCount.toFloat()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ObsidianBlack)
            .padding(horizontal = 20.dp, vertical = 14.dp)
            .verticalScroll(scrollState),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = strings.appTitle,
                    style = MaterialTheme.typography.headlineMedium
                )
                Text(
                    text = if (permissionSnapshot.allCoreGranted) {
                        strings.dashboardStatusActive
                    } else {
                        strings.dashboardStatusNeedsPerms
                    },
                    style = MaterialTheme.typography.labelSmall.copy(
                        color = if (permissionSnapshot.allCoreGranted) EmeraldGranted else AmberWarning
                    )
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(
                    onClick = onToggleLanguage,
                    border = BorderStroke(1.dp, GoldBorder),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        text = if (settings.language == AppLanguage.ENGLISH) "SW" else "EN",
                        color = ChampagneGold
                    )
                }
                IconButton(onClick = onOpenSettings) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = "Settings and Privacy",
                        tint = ChampagneGold
                    )
                }
            }
        }

        HorizontalDivider(color = GoldBorder)

        // Voice Assistant & Universal Q&A Quick Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.5.dp, ChampagneGold),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "SIRI-LIKE VOICE ASSISTANT",
                    style = MaterialTheme.typography.titleMedium.copy(color = ChampagneGold)
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = if (settings.aiEnabled && settings.hasGeminiKey) {
                        "Ready to answer any question or run voice commands (${settings.voiceInputLocale.label})."
                    } else {
                        "Ready for offline voice commands (${settings.voiceInputLocale.label}). Add Gemini key in Voice tab for full Q&A."
                    },
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(10.dp))
                Button(
                    onClick = onOpenVoice,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MetallicGold,
                        contentColor = ObsidianBlack
                    ),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                ) {
                    Text("ASK MACHINE VOICE", style = MaterialTheme.typography.labelLarge)
                }
            }
        }

        // Exact Reminders & Meetings Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, if (overdueReminderCount > 0) CrimsonAlert else GoldBorder),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "REMINDERS & CALENDAR",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = if (overdueReminderCount > 0) {
                            "$overdueReminderCount OVERDUE"
                        } else {
                            "$activeReminderCount ACTIVE"
                        },
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = if (overdueReminderCount > 0) CrimsonAlert else EmeraldGranted
                        )
                    )
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = if (permissionSnapshot.exactAlarm) {
                        "Exact AlarmManager alerts active at 1d, 1h, 10m & start."
                    } else {
                        "Grant Alarms & Reminders permission for exact timing."
                    },
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedButton(
                    onClick = onOpenReminders,
                    border = BorderStroke(1.dp, MetallicGold),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(46.dp)
                ) {
                    Text("OPEN REMINDERS", color = MetallicGold, style = MaterialTheme.typography.labelLarge)
                }
            }
        }

        // Smart Morning Briefing Quick Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, ChampagneGold.copy(alpha = 0.65f)),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "SMART MORNING BRIEFING",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = if (settings.morningBriefingEnabled) {
                            settings.morningBriefingTime
                        } else {
                            "MANUAL"
                        },
                        style = MaterialTheme.typography.labelSmall.copy(color = ChampagneGold)
                    )
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Digest of today's schedule, overdue alerts, missed calls, and VIP messages.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onOpenBriefing,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MetallicGold,
                            contentColor = ObsidianBlack
                        ),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(46.dp)
                    ) {
                        Text("OPEN BRIEFING", style = MaterialTheme.typography.labelLarge)
                    }
                    OutlinedButton(
                        onClick = onPlayBriefing,
                        border = BorderStroke(1.dp, MetallicGold),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(46.dp)
                    ) {
                        Text("PLAY NOW", color = MetallicGold)
                    }
                }
            }
        }

        // Notification Reader + TTS Status Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, ChampagneGold.copy(alpha = 0.65f)),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "NOTIFICATION READER · TTS",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = if (!permissionSnapshot.notificationListener) {
                            "ACCESS OFF"
                        } else if (settings.notificationReaderEnabled) {
                            "LISTENING"
                        } else {
                            "MUTED"
                        },
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = if (permissionSnapshot.notificationListener && settings.notificationReaderEnabled) {
                                EmeraldGranted
                            } else {
                                AmberWarning
                            }
                        )
                    )
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "$recentNotificationCount recent alerts logged · " +
                        if (settings.headphoneOnlyMode) "Headphones/BT Privacy ON" else "Speaker & Headset Active",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onOpenNotifications,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MetallicGold,
                            contentColor = ObsidianBlack
                        ),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(46.dp)
                    ) {
                        Text("OPEN INBOX", style = MaterialTheme.typography.labelLarge)
                    }
                    OutlinedButton(
                        onClick = if (isSpeaking) onStopSpeech else onOpenRules,
                        border = BorderStroke(1.dp, if (isSpeaking) CrimsonAlert else MetallicGold),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(46.dp)
                    ) {
                        Text(
                            text = if (isSpeaking) "STOP VOICE" else "APP RULES",
                            color = if (isSpeaking) CrimsonAlert else MetallicGold
                        )
                    }
                }
            }
        }

        // Core permissions & Samsung readiness card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = strings.permissionsHeadline,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = "${permissionSnapshot.coreReadyCount} / ${permissionSnapshot.coreTotalCount}",
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
                LinearProgressIndicator(
                    progress = { coreRatio },
                    color = MetallicGold,
                    trackColor = ObsidianBlack,
                    modifier = Modifier.fillMaxWidth().height(6.dp)
                )
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onOpenPermissions,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MetallicGold,
                        contentColor = ObsidianBlack
                    ),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(46.dp)
                ) {
                    Text(
                        text = strings.openPermissionChecklist,
                        style = MaterialTheme.typography.labelLarge
                    )
                }
            }
        }

        // Foreground keep-alive control card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "BACKGROUND GUARD",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = if (keepAliveRunning) "RUNNING" else "PAUSED",
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = if (keepAliveRunning) EmeraldGranted else AmberWarning
                        )
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(
                    onClick = onToggleKeepAlive,
                    border = BorderStroke(1.dp, MetallicGold),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(46.dp)
                ) {
                    Text(
                        text = if (keepAliveRunning) strings.stopKeepAlive else strings.startKeepAlive,
                        color = MetallicGold,
                        style = MaterialTheme.typography.labelLarge
                    )
                }
            }
        }

        // Privacy mode summary + build roadmap status
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "PRIVACY & MODULE PIPELINE",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = if (settings.aiEnabled) {
                        "Mode: Gemini Opt-In (${if (settings.hasGeminiKey) "Key Saved" else "No Key Yet"})"
                    } else {
                        "Mode: 100% On-Device (No Cloud AI)"
                    },
                    style = MaterialTheme.typography.bodyLarge.copy(color = IvoryText)
                )
                Text(
                    text = "• Step 1: Project, Theme, Onboarding & Permissions — READY\n" +
                        "• Step 2: Notification Listener & TTS Queue — READY\n" +
                        "• Step 3: Call Announcer, Local Caller ID & Overlay — READY\n" +
                        "• Step 4: Voice Assistant & Gemini Commands — READY\n" +
                        "• Step 5: Exact Reminders & Calendar Intent — READY\n" +
                        "• Step 6: Smart Morning Briefing — READY\n" +
                        "• Step 7: Full Settings, Retention & Data Wipe — READY",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(4.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onOpenSettings,
                        border = BorderStroke(1.dp, MetallicGold),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(text = "SETTINGS & BACKUP", color = MetallicGold)
                    }
                    OutlinedButton(
                        onClick = onReviewOnboarding,
                        border = BorderStroke(1.dp, GoldBorder),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(text = "DISCLOSURE", color = ChampagneGold)
                    }
                }
            }
        }
    }
}
