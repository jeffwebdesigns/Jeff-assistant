package com.machine.voice.ui.reminders

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.filled.AddAlert
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.machine.voice.data.local.ReminderEntity
import com.machine.voice.permissions.PermissionSnapshot
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
import com.machine.voice.ui.theme.ObsidianElevated
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@Composable
fun RemindersScreen(
    reminders: List<ReminderEntity>,
    permissionSnapshot: PermissionSnapshot,
    onCreateReminder: (title: String, notes: String, triggerAtMillis: Long, isMeeting: Boolean) -> Unit,
    onToggleCompleted: (ReminderEntity) -> Unit,
    onDeleteReminder: (ReminderEntity) -> Unit,
    onAddToCalendar: (ReminderEntity) -> Unit,
    onSpeakOverdue: (List<ReminderEntity>) -> Unit,
    onOpenExactAlarmSettings: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val scrollState = rememberScrollState()
    val now = System.currentTimeMillis()

    var titleDraft by remember { mutableStateOf("") }
    var notesDraft by remember { mutableStateOf("") }
    var isMeetingDraft by remember { mutableStateOf(false) }
    var triggerDraftMillis by remember {
        mutableLongStateOf(System.currentTimeMillis() + 3_600_000L)
    }

    val activeReminders = remember(reminders) { reminders.filter { !it.completed } }
    val completedReminders = remember(reminders) { reminders.filter { it.completed } }
    val overdueReminders = remember(activeReminders, now) {
        activeReminders.filter { it.triggerAtMillis <= now }
    }

    val dateTimeFormatter = remember {
        SimpleDateFormat("EEE, dd MMM yyyy · HH:mm", Locale.getDefault())
    }

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
                    text = "REMINDERS",
                    style = MaterialTheme.typography.headlineMedium
                )
                Text(
                    text = "${activeReminders.size} active · Exact alerts at 1d, 1h, 10m & start",
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

        // Exact Alarm Permission Banner (Android 12+ / Galaxy A06 reliability)
        if (!permissionSnapshot.exactAlarm) {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, AmberWarning),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "EXACT ALARMS NOT GRANTED",
                        style = MaterialTheme.typography.titleMedium.copy(color = AmberWarning)
                    )
                    Text(
                        text = "Grant Alarms & Reminders permission so Samsung Doze never delays 1d, 1h, or 10m meeting alerts.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Button(
                        onClick = onOpenExactAlarmSettings,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = AmberWarning,
                            contentColor = ObsidianBlack
                        ),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("ALLOW EXACT ALARMS", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }

        // Overdue / Missed Reminders Catch-Up Banner
        if (overdueReminders.isNotEmpty()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.5.dp, CrimsonAlert),
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "${overdueReminders.size} OVERDUE REMINDER${if (overdueReminders.size == 1) "" else "S"}",
                            style = MaterialTheme.typography.titleMedium.copy(color = CrimsonAlert)
                        )
                        Text(
                            text = overdueReminders.first().title,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    OutlinedButton(
                        onClick = { onSpeakOverdue(overdueReminders) },
                        border = BorderStroke(1.dp, CrimsonAlert),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Icon(
                            Icons.Default.VolumeUp,
                            contentDescription = "Read overdue reminders",
                            tint = CrimsonAlert,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("READ", color = CrimsonAlert)
                    }
                }
            }
        }

        // Composer Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, ChampagneGold.copy(alpha = 0.65f)),
            shape = RoundedCornerShape(14.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "NEW REMINDER OR MEETING",
                    style = MaterialTheme.typography.titleMedium
                )

                OutlinedTextField(
                    value = titleDraft,
                    onValueChange = { titleDraft = it },
                    label = { Text("Title (e.g. Pay rent via M-Pesa, Client call)") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MetallicGold,
                        unfocusedBorderColor = GoldBorder,
                        focusedTextColor = IvoryText,
                        unfocusedTextColor = IvoryText
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = notesDraft,
                    onValueChange = { notesDraft = it },
                    label = { Text("Optional notes or KES amount") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MetallicGold,
                        unfocusedBorderColor = GoldBorder,
                        focusedTextColor = IvoryText,
                        unfocusedTextColor = IvoryText
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                // Reminder vs Meeting toggle
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val types = listOf(false to "REMINDER", true to "MEETING")
                    types.forEach { (meetingFlag, label) ->
                        val selected = isMeetingDraft == meetingFlag
                        OutlinedButton(
                            onClick = { isMeetingDraft = meetingFlag },
                            border = BorderStroke(
                                width = if (selected) 1.5.dp else 1.dp,
                                color = if (selected) ChampagneGold else GoldBorder
                            ),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (selected) ObsidianElevated else ObsidianBlack
                            ),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f).height(42.dp)
                        ) {
                            Text(
                                text = label,
                                style = MaterialTheme.typography.labelSmall.copy(
                                    color = if (selected) ChampagneGold else MutedIvory
                                )
                            )
                        }
                    }
                }

                // Quick Preset Chips
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val presets = listOf(
                        "+15 min" to { System.currentTimeMillis() + 900_000L },
                        "+1 hour" to { System.currentTimeMillis() + 3_600_000L },
                        "Tonight 20:00" to { presetHourTodayOrTomorrow(20, 0) },
                        "Tomorrow 09:00" to { presetTomorrowAt(9, 0) }
                    )
                    presets.forEach { (label, compute) ->
                        OutlinedButton(
                            onClick = { triggerDraftMillis = compute() },
                            border = BorderStroke(1.dp, GoldBorder),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.height(36.dp)
                        ) {
                            Text(label, color = ChampagneGold, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                // Native Date & Time Picker Buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            val cal = Calendar.getInstance().apply { timeInMillis = triggerDraftMillis }
                            DatePickerDialog(
                                context,
                                { _, year, month, day ->
                                    val updated = Calendar.getInstance().apply {
                                        timeInMillis = triggerDraftMillis
                                        set(Calendar.YEAR, year)
                                        set(Calendar.MONTH, month)
                                        set(Calendar.DAY_OF_MONTH, day)
                                    }
                                    triggerDraftMillis = updated.timeInMillis
                                },
                                cal.get(Calendar.YEAR),
                                cal.get(Calendar.MONTH),
                                cal.get(Calendar.DAY_OF_MONTH)
                            ).show()
                        },
                        border = BorderStroke(1.dp, MetallicGold),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(44.dp)
                    ) {
                        Icon(
                            Icons.Default.CalendarMonth,
                            contentDescription = null,
                            tint = MetallicGold,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("PICK DATE", color = MetallicGold)
                    }

                    OutlinedButton(
                        onClick = {
                            val cal = Calendar.getInstance().apply { timeInMillis = triggerDraftMillis }
                            TimePickerDialog(
                                context,
                                { _, hour, minute ->
                                    val updated = Calendar.getInstance().apply {
                                        timeInMillis = triggerDraftMillis
                                        set(Calendar.HOUR_OF_DAY, hour)
                                        set(Calendar.MINUTE, minute)
                                        set(Calendar.SECOND, 0)
                                    }
                                    triggerDraftMillis = updated.timeInMillis
                                },
                                cal.get(Calendar.HOUR_OF_DAY),
                                cal.get(Calendar.MINUTE),
                                true
                            ).show()
                        },
                        border = BorderStroke(1.dp, MetallicGold),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(44.dp)
                    ) {
                        Icon(
                            Icons.Default.Schedule,
                            contentDescription = null,
                            tint = MetallicGold,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("PICK TIME", color = MetallicGold)
                    }
                }

                Text(
                    text = "Scheduled: ${dateTimeFormatter.format(Date(triggerDraftMillis))}",
                    style = MaterialTheme.typography.bodyLarge.copy(color = ChampagneGold)
                )

                Button(
                    onClick = {
                        val cleanTitle = titleDraft.trim()
                        if (cleanTitle.isNotEmpty()) {
                            onCreateReminder(
                                cleanTitle,
                                notesDraft.trim(),
                                triggerDraftMillis,
                                isMeetingDraft
                            )
                            titleDraft = ""
                            notesDraft = ""
                        }
                    },
                    enabled = titleDraft.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MetallicGold,
                        contentColor = ObsidianBlack
                    ),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                ) {
                    Icon(Icons.Default.AddAlert, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("SAVE & SCHEDULE ALERTS", style = MaterialTheme.typography.labelLarge)
                }
            }
        }

        // Active Reminders Section
        Text(
            text = "ACTIVE SCHEDULE (${activeReminders.size})",
            style = MaterialTheme.typography.titleMedium
        )
        if (activeReminders.isEmpty()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = ObsidianElevated),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(
                    text = "No active reminders. Add one above or say \"Set a reminder for 5pm\" on the Voice tab.",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(16.dp)
                )
            }
        } else {
            activeReminders.forEach { item ->
                ReminderCard(
                    item = item,
                    formattedWhen = dateTimeFormatter.format(Date(item.triggerAtMillis)),
                    isOverdue = item.triggerAtMillis <= now,
                    onToggleCompleted = { onToggleCompleted(item) },
                    onAddToCalendar = { onAddToCalendar(item) },
                    onDelete = { onDeleteReminder(item) }
                )
            }
        }

        // Completed Reminders Section
        if (completedReminders.isNotEmpty()) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "COMPLETED (${completedReminders.size})",
                style = MaterialTheme.typography.titleMedium.copy(color = MutedIvory)
            )
            completedReminders.take(15).forEach { item ->
                ReminderCard(
                    item = item,
                    formattedWhen = dateTimeFormatter.format(Date(item.triggerAtMillis)),
                    isOverdue = false,
                    onToggleCompleted = { onToggleCompleted(item) },
                    onAddToCalendar = { onAddToCalendar(item) },
                    onDelete = { onDeleteReminder(item) }
                )
            }
        }
    }
}

@Composable
private fun ReminderCard(
    item: ReminderEntity,
    formattedWhen: String,
    isOverdue: Boolean,
    onToggleCompleted: () -> Unit,
    onAddToCalendar: () -> Unit,
    onDelete: () -> Unit
) {
    val borderColor = when {
        item.completed -> GoldBorder
        isOverdue -> CrimsonAlert
        else -> ChampagneGold.copy(alpha = 0.65f)
    }

    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (item.completed) ObsidianElevated else CharcoalPanel
        ),
        border = BorderStroke(1.dp, borderColor),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val badge = buildString {
                    append(if (item.isMeeting) "MEETING" else "REMINDER")
                    if (item.completed) append(" · DONE")
                    else if (isOverdue) append(" · OVERDUE")
                }
                Text(
                    text = badge,
                    style = MaterialTheme.typography.labelSmall.copy(
                        color = when {
                            item.completed -> EmeraldGranted
                            isOverdue -> CrimsonAlert
                            else -> ChampagneGold
                        }
                    )
                )
                IconButton(
                    onClick = onDelete,
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(
                        Icons.Default.DeleteOutline,
                        contentDescription = "Delete reminder",
                        tint = MutedIvory,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            Text(
                text = item.title,
                style = MaterialTheme.typography.headlineSmall.copy(
                    color = if (item.completed) MutedIvory else IvoryText
                )
            )

            Text(
                text = formattedWhen,
                style = MaterialTheme.typography.bodyMedium.copy(
                    color = if (isOverdue && !item.completed) CrimsonAlert else ChampagneGold
                )
            )

            if (item.notes.isNotBlank()) {
                Text(
                    text = item.notes,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            if (!item.completed) {
                Text(
                    text = "Spoken alerts scheduled: 1d · 1h · 10m · Start time",
                    style = MaterialTheme.typography.labelSmall.copy(color = MutedIvory)
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onToggleCompleted,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (item.completed) CharcoalPanel else MetallicGold,
                        contentColor = if (item.completed) MetallicGold else ObsidianBlack
                    ),
                    border = if (item.completed) BorderStroke(1.dp, GoldBorder) else null,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.weight(1f).height(42.dp)
                ) {
                    Icon(
                        imageVector = if (item.completed) Icons.Default.Refresh else Icons.Default.CheckCircle,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(if (item.completed) "REOPEN" else "DONE")
                }

                OutlinedButton(
                    onClick = onAddToCalendar,
                    border = BorderStroke(1.dp, MetallicGold),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.weight(1f).height(42.dp)
                ) {
                    Icon(
                        Icons.Default.Event,
                        contentDescription = null,
                        tint = MetallicGold,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("CALENDAR", color = MetallicGold)
                }
            }
        }
    }
}

private fun presetHourTodayOrTomorrow(hour: Int, minute: Int): Long {
    val cal = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, hour)
        set(Calendar.MINUTE, minute)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }
    if (cal.timeInMillis <= System.currentTimeMillis() + 60_000L) {
        cal.add(Calendar.DAY_OF_YEAR, 1)
    }
    return cal.timeInMillis
}

private fun presetTomorrowAt(hour: Int, minute: Int): Long {
    return Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, 1)
        set(Calendar.HOUR_OF_DAY, hour)
        set(Calendar.MINUTE, minute)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }.timeInMillis
}
