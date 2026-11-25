package com.machine.voice.ui.briefing

import android.app.TimePickerDialog
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.machine.voice.briefing.BriefingReport
import com.machine.voice.briefing.BriefingScheduler
import com.machine.voice.data.prefs.OwnerSettings
import com.machine.voice.ui.theme.ChampagneGold
import com.machine.voice.ui.theme.CharcoalPanel
import com.machine.voice.ui.theme.CrimsonAlert
import com.machine.voice.ui.theme.EmeraldGranted
import com.machine.voice.ui.theme.GoldBorder
import com.machine.voice.ui.theme.IvoryText
import com.machine.voice.ui.theme.MetallicGold
import com.machine.voice.ui.theme.MutedIvory
import com.machine.voice.ui.theme.ObsidianBlack
import com.machine.voice.ui.theme.ObsidianElevated
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun BriefingScreen(
    settings: OwnerSettings,
    report: BriefingReport?,
    isLoading: Boolean,
    isSpeaking: Boolean,
    onRefresh: () -> Unit,
    onPlayBriefing: (String) -> Unit,
    onStopSpeech: () -> Unit,
    onToggleDailyNotification: (Boolean) -> Unit,
    onSetBriefingTime: (String) -> Unit,
    onToggleSpeakOnUnlock: (Boolean) -> Unit,
    onOpenReminders: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val scrollState = rememberScrollState()
    val timeFmt = remember { SimpleDateFormat("HH:mm", Locale.getDefault()) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ObsidianBlack)
            .padding(horizontal = 20.dp, vertical = 14.dp)
            .verticalScroll(scrollState),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "SMART BRIEFING",
                    style = MaterialTheme.typography.headlineMedium
                )
                Text(
                    text = if (isLoading) {
                        "Compiling local summary..."
                    } else if (report != null) {
                        "Updated ${timeFmt.format(Date(report.generatedAt))}"
                    } else {
                        "Say \"Briefing\" anywhere to hear this digest"
                    },
                    style = MaterialTheme.typography.labelSmall.copy(color = MetallicGold)
                )
            }
            OutlinedButton(
                onClick = onBack,
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(8.dp)
            ) {
                Text("BACK", color = ChampagneGold)
            }
        }

        HorizontalDivider(color = GoldBorder)

        // Hero Spoken Briefing Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.5.dp, ChampagneGold),
            shape = RoundedCornerShape(14.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = if (report?.usedCloudAi == true) "MORNING DIGEST · GEMINI" else "MORNING DIGEST · LOCAL",
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = if (report?.usedCloudAi == true) EmeraldGranted else ChampagneGold
                        )
                    )
                    if (report != null) {
                        Text(
                            text = "${report.urgentItemCount} PRIORITY",
                            style = MaterialTheme.typography.labelSmall.copy(
                                color = if (report.urgentItemCount > 0) ChampagneGold else MutedIvory
                            )
                        )
                    }
                }

                Text(
                    text = report?.headline ?: "Preparing morning summary...",
                    style = MaterialTheme.typography.titleMedium.copy(color = IvoryText)
                )

                Text(
                    text = report?.spokenScript ?: "Loading reminders, missed calls, and VIP messages...",
                    style = MaterialTheme.typography.bodyLarge.copy(color = IvoryText)
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = {
                            if (isSpeaking) {
                                onStopSpeech()
                            } else if (report != null) {
                                onPlayBriefing(report.spokenScript)
                            }
                        },
                        enabled = report != null && !isLoading,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isSpeaking) CrimsonAlert else MetallicGold,
                            contentColor = ObsidianBlack
                        ),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(48.dp)
                    ) {
                        Icon(
                            imageVector = if (isSpeaking) Icons.Default.Stop else Icons.Default.PlayArrow,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (isSpeaking) "STOP VOICE" else "PLAY BRIEFING",
                            style = MaterialTheme.typography.labelLarge
                        )
                    }

                    OutlinedButton(
                        onClick = onRefresh,
                        enabled = !isLoading,
                        border = BorderStroke(1.dp, MetallicGold),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.height(48.dp)
                    ) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = "Refresh",
                            tint = MetallicGold,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
        }

        if (report != null) {
            // Overdue & Today's Reminders Card
            Card(
                colors = CardDefaults.cardColors(containerColor = ObsidianElevated),
                border = BorderStroke(
                    width = 1.dp,
                    color = if (report.overdueReminders.isNotEmpty()) CrimsonAlert else GoldBorder
                ),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "SCHEDULE & OVERDUE (${report.overdueReminders.size + report.todayReminders.size})",
                            style = MaterialTheme.typography.titleMedium
                        )
                        OutlinedButton(
                            onClick = onOpenReminders,
                            border = BorderStroke(1.dp, GoldBorder),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.height(34.dp)
                        ) {
                            Text("MANAGE", color = ChampagneGold, style = MaterialTheme.typography.labelSmall)
                        }
                    }

                    if (report.overdueReminders.isEmpty() && report.todayReminders.isEmpty()) {
                        Text(
                            text = "No overdue or today-scheduled reminders.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    } else {
                        report.overdueReminders.forEach { item ->
                            Text(
                                text = "OVERDUE · ${item.title} (${timeFmt.format(Date(item.triggerAtMillis))})",
                                style = MaterialTheme.typography.bodyLarge.copy(color = CrimsonAlert)
                            )
                        }
                        report.todayReminders.forEach { item ->
                            Text(
                                text = "${timeFmt.format(Date(item.triggerAtMillis))} · ${item.title}",
                                style = MaterialTheme.typography.bodyLarge.copy(color = IvoryText)
                            )
                        }
                    }
                }
            }

            // Missed Calls Card
            Card(
                colors = CardDefaults.cardColors(containerColor = ObsidianElevated),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = "MISSED CALLS · LAST 24H (${report.missedCalls.size})",
                        style = MaterialTheme.typography.titleMedium
                    )
                    if (report.missedCalls.isEmpty()) {
                        Text(
                            text = "No missed calls logged in the last 24 hours.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    } else {
                        report.missedCalls.take(8).forEach { call ->
                            val who = call.contactName ?: call.rawNumber
                            val tag = call.tagLabel?.let { " [$it]" }.orEmpty()
                            Text(
                                text = "• $who$tag · ${call.formattedTime}",
                                style = MaterialTheme.typography.bodyLarge
                            )
                        }
                    }
                }
            }

            // VIP & Notification Digest Card
            Card(
                colors = CardDefaults.cardColors(containerColor = ObsidianElevated),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = "VIP ALERTS (${report.vipMessages.size}) · TOTAL 24H (${report.recentMessageCount})",
                        style = MaterialTheme.typography.titleMedium
                    )
                    if (report.vipMessages.isEmpty()) {
                        Text(
                            text = "No VIP sender messages in the past 24 hours.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    } else {
                        report.vipMessages.take(8).forEach { msg ->
                            val body = if (msg.isSensitiveShielded) {
                                "Verification code received (shielded)"
                            } else {
                                msg.previewText
                            }
                            Text(
                                text = "• ${msg.sender} (${msg.appName}): $body",
                                style = MaterialTheme.typography.bodyLarge
                            )
                        }
                    }
                }
            }
        }

        // Morning Schedule & Unlock Automation Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "MORNING SCHEDULE & UNLOCK",
                    style = MaterialTheme.typography.titleMedium
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Daily Morning Briefing Alert", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Schedules a morning summary notification & spoken digest at ${settings.morningBriefingTime}.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    Switch(
                        checked = settings.morningBriefingEnabled,
                        onCheckedChange = onToggleDailyNotification,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = ObsidianBlack,
                            checkedTrackColor = MetallicGold
                        )
                    )
                }

                OutlinedButton(
                    onClick = {
                        val current = BriefingScheduler.parseTimeOrDefault(settings.morningBriefingTime)
                        TimePickerDialog(
                            context,
                            { _, hour, minute ->
                                val formatted = String.format(Locale.US, "%02d:%02d", hour, minute)
                                onSetBriefingTime(formatted)
                            },
                            current.hour,
                            current.minute,
                            true
                        ).show()
                    },
                    border = BorderStroke(1.dp, MetallicGold),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(44.dp)
                ) {
                    Icon(
                        Icons.Default.Schedule,
                        contentDescription = null,
                        tint = MetallicGold,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("SET MORNING TIME (${settings.morningBriefingTime})", color = MetallicGold)
                }

                HorizontalDivider(color = GoldBorder)

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Speak on First Morning Unlock", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Speaks your briefing once per day the first time you unlock your phone after ${settings.morningBriefingTime} while Background Guard is active.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    Switch(
                        checked = settings.speakBriefingOnUnlock,
                        onCheckedChange = onToggleSpeakOnUnlock,
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
