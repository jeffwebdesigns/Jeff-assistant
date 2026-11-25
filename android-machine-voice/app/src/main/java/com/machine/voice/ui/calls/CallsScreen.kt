package com.machine.voice.ui.calls

import android.content.Intent
import android.provider.CallLog
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.machine.voice.calls.DeviceCallLogEntry
import com.machine.voice.data.local.CallerTagEntity
import com.machine.voice.data.prefs.OwnerSettings
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CallsCallerIdScreen(
    settings: OwnerSettings,
    permissionSnapshot: PermissionSnapshot,
    recentCalls: List<DeviceCallLogEntry>,
    savedTags: List<CallerTagEntity>,
    onToggleCallAnnouncer: (Boolean) -> Unit,
    onToggleCallerOverlay: (Boolean) -> Unit,
    onToggleSilenceSpam: (Boolean) -> Unit,
    onToggleRejectSpam: (Boolean) -> Unit,
    onSaveCallerTag: (normalized: String, displayNumber: String, tagLabel: String, isSpam: Boolean) -> Unit,
    onDeleteCallerTag: (normalized: String) -> Unit,
    onRefreshCallLog: () -> Unit,
    onTestCallOverlay: () -> Unit,
    onRequestCallScreeningRole: () -> Unit,
    onOpenOverlaySettings: () -> Unit,
    onRequestPhonePermissions: () -> Unit
) {
    val context = LocalContext.current
    var editingEntry by remember { mutableStateOf<DeviceCallLogEntry?>(null) }
    var tagInput by remember { mutableStateOf("") }
    var spamChecked by remember { mutableStateOf(false) }

    val quickTags = listOf("Delivery guy", "Bank", "Client", "Family", "Scam", "Spam")

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(ObsidianBlack)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "CALLS & LOCAL ID", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        text = if (permissionSnapshot.callScreeningRole) {
                            "CALL SCREENING ACTIVE · DEVICE-ONLY"
                        } else {
                            "PHONE STATE ACTIVE · SCREENING ROLE OPTIONAL"
                        },
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = if (permissionSnapshot.callScreeningRole) EmeraldGranted else AmberWarning
                        )
                    )
                }
                OutlinedButton(
                    onClick = onTestCallOverlay,
                    border = BorderStroke(1.dp, MetallicGold),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("TEST CALL", color = MetallicGold)
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
            HorizontalDivider(color = GoldBorder)
        }

        // Permission check banner if Phone/CallLog or Overlay missing
        if (!permissionSnapshot.phoneAndCalls || !permissionSnapshot.callLog || !permissionSnapshot.overlay) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                    border = BorderStroke(1.dp, AmberWarning),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = "PERMISSIONS NEEDED FOR FULL CALLER ID",
                            style = MaterialTheme.typography.titleMedium.copy(color = AmberWarning)
                        )
                        if (!permissionSnapshot.phoneAndCalls || !permissionSnapshot.callLog) {
                            Button(
                                onClick = onRequestPhonePermissions,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MetallicGold,
                                    contentColor = ObsidianBlack
                                ),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("GRANT PHONE, CONTACTS & CALL LOG")
                            }
                        }
                        if (!permissionSnapshot.overlay) {
                            OutlinedButton(
                                onClick = onOpenOverlaySettings,
                                border = BorderStroke(1.dp, MetallicGold),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("ALLOW GOLD INCOMING OVERLAY", color = MetallicGold)
                            }
                        }
                    }
                }
            }
        }

        // Screening Role + Controls Card
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("CALL ANNOUNCER & SCREENING", style = MaterialTheme.typography.titleMedium)

                    CallSwitchRow(
                        label = "Speak Incoming Callers",
                        checked = settings.callAnnouncerEnabled,
                        onCheckedChange = onToggleCallAnnouncer
                    )
                    CallSwitchRow(
                        label = "Show Gold Incoming Call Card",
                        checked = settings.callerOverlayEnabled,
                        onCheckedChange = onToggleCallerOverlay
                    )
                    CallSwitchRow(
                        label = "Silence My Marked Spam Calls",
                        checked = settings.silenceMarkedSpamCalls,
                        onCheckedChange = onToggleSilenceSpam
                    )
                    CallSwitchRow(
                        label = "Reject My Marked Spam Calls",
                        checked = settings.rejectMarkedSpamCalls,
                        onCheckedChange = onToggleRejectSpam
                    )

                    if (!permissionSnapshot.callScreeningRole) {
                        Button(
                            onClick = onRequestCallScreeningRole,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MetallicGold,
                                contentColor = ObsidianBlack
                            ),
                            modifier = Modifier.fillMaxWidth().height(46.dp)
                        ) {
                            Text("SET AS CALL SCREENING APP", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }
        }

        // Public Spam Directory Guidance (zero external scraping)
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, GoldBorder),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("PRIVACY-FIRST SPAM PROTECTION", style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = "Machine Voice matches callers strictly against your own contacts, tags, and personal spam list—never scraping anyone's data. " +
                            "For large public spam databases, enable Caller ID & spam protection in Google Phone.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    OutlinedButton(
                        onClick = {
                            val dialerIntent = Intent(Intent.ACTION_VIEW, CallLog.Calls.CONTENT_URI).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            try {
                                context.startActivity(dialerIntent)
                            } catch (_: Exception) {
                            }
                        },
                        border = BorderStroke(1.dp, GoldBorder),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("OPEN PHONE APP SETTINGS", color = ChampagneGold)
                    }
                }
            }
        }

        // Recent Call Log Header
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("RECENT CALL LOG (${recentCalls.size})", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = onRefreshCallLog) {
                    Text("REFRESH", color = ChampagneGold)
                }
            }
        }

        if (recentCalls.isEmpty()) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                    border = BorderStroke(1.dp, GoldBorder),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = if (permissionSnapshot.callLog) {
                                "No recent calls found on this device."
                            } else {
                                "Grant Call Log permission to tag callers and block spam with one tap."
                            },
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }
        } else {
            items(recentCalls, key = { "${it.id}_${it.timestamp}" }) { entry ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                    border = BorderStroke(
                        1.dp,
                        when {
                            entry.isSpam -> CrimsonAlert
                            !entry.tagLabel.isNullOrBlank() -> ChampagneGold
                            else -> GoldBorder
                        }
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = entry.contactName ?: entry.rawNumber,
                                    style = MaterialTheme.typography.bodyLarge.copy(
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (entry.isSpam) CrimsonAlert else IvoryText
                                    )
                                )
                                if (entry.contactName != null) {
                                    Text(
                                        text = entry.rawNumber,
                                        style = MaterialTheme.typography.bodyMedium
                                    )
                                }
                            }
                            Text(
                                text = "${entry.callTypeLabel} · ${entry.formattedTime}",
                                style = MaterialTheme.typography.labelSmall
                            )
                        }

                        if (!entry.tagLabel.isNullOrBlank() || entry.isSpam) {
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = buildString {
                                    if (!entry.tagLabel.isNullOrBlank()) append("TAG: ${entry.tagLabel}")
                                    if (entry.isSpam) {
                                        if (isNotEmpty()) append(" · ")
                                        append("PERSONAL SPAM")
                                    }
                                },
                                style = MaterialTheme.typography.labelSmall.copy(
                                    color = if (entry.isSpam) CrimsonAlert else ChampagneGold
                                )
                            )
                        }

                        Spacer(modifier = Modifier.height(10.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = {
                                    editingEntry = entry
                                    tagInput = entry.tagLabel.orEmpty()
                                    spamChecked = entry.isSpam
                                },
                                border = BorderStroke(1.dp, MetallicGold),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1f).height(40.dp)
                            ) {
                                Text(
                                    text = if (entry.tagLabel.isNullOrBlank()) "TAG CALLER" else "EDIT TAG",
                                    color = MetallicGold
                                )
                            }
                            Button(
                                onClick = {
                                    val nextSpam = !entry.isSpam
                                    val label = entry.tagLabel ?: if (nextSpam) "Spam" else ""
                                    onSaveCallerTag(
                                        entry.normalizedNumber,
                                        entry.rawNumber,
                                        label,
                                        nextSpam
                                    )
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = if (entry.isSpam) CharcoalPanel else CrimsonAlert,
                                    contentColor = IvoryText
                                ),
                                border = if (entry.isSpam) BorderStroke(1.dp, EmeraldGranted) else null,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1f).height(40.dp)
                            ) {
                                Text(if (entry.isSpam) "UNMARK SPAM" else "MARK SPAM")
                            }
                        }
                    }
                }
            }
        }

        if (savedTags.isNotEmpty()) {
            item {
                Spacer(modifier = Modifier.height(6.dp))
                Text("PERSONAL TAGS & BLOCK LIST (${savedTags.size})", style = MaterialTheme.typography.titleMedium)
            }
            items(savedTags, key = { it.normalizedNumber }) { tag ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                    border = BorderStroke(1.dp, if (tag.isSpam) CrimsonAlert else GoldBorder),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = tag.displayNumber,
                                style = MaterialTheme.typography.bodyLarge
                            )
                            Text(
                                text = "${tag.tagLabel.ifBlank { "Tagged" }}${if (tag.isSpam) " · BLOCKED/SPAM" else ""}",
                                style = MaterialTheme.typography.labelSmall.copy(
                                    color = if (tag.isSpam) CrimsonAlert else ChampagneGold
                                )
                            )
                        }
                        TextButton(onClick = { onDeleteCallerTag(tag.normalizedNumber) }) {
                            Text("DELETE", color = CrimsonAlert)
                        }
                    }
                }
            }
        }
    }

    val currentEdit = editingEntry
    if (currentEdit != null) {
        AlertDialog(
            onDismissRequest = { editingEntry = null },
            containerColor = CharcoalPanel,
            title = {
                Text(
                    text = currentEdit.contactName ?: currentEdit.rawNumber,
                    style = MaterialTheme.typography.titleMedium
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        quickTags.forEach { preset ->
                            FilterChip(
                                selected = tagInput.equals(preset, ignoreCase = true),
                                onClick = {
                                    tagInput = preset
                                    if (preset == "Scam" || preset == "Spam") spamChecked = true
                                },
                                label = { Text(preset) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = MetallicGold,
                                    selectedLabelColor = ObsidianBlack,
                                    labelColor = IvoryText
                                )
                            )
                        }
                    }
                    OutlinedTextField(
                        value = tagInput,
                        onValueChange = { tagInput = it },
                        label = { Text("Custom Tag (e.g. Delivery guy)", color = MutedIvory) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = MetallicGold,
                            unfocusedBorderColor = GoldBorder,
                            focusedTextColor = IvoryText,
                            unfocusedTextColor = IvoryText
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                    CallSwitchRow(
                        label = "Mark as Personal Spam",
                        checked = spamChecked,
                        onCheckedChange = { spamChecked = it }
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onSaveCallerTag(
                            currentEdit.normalizedNumber,
                            currentEdit.rawNumber,
                            tagInput.trim(),
                            spamChecked
                        )
                        editingEntry = null
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MetallicGold,
                        contentColor = ObsidianBlack
                    )
                ) {
                    Text("SAVE")
                }
            },
            dismissButton = {
                TextButton(onClick = { editingEntry = null }) {
                    Text("CANCEL", color = MutedIvory)
                }
            }
        )
    }
}

@Composable
private fun CallSwitchRow(
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
