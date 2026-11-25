package com.machine.voice.ui.settings

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.filled.CleaningServices
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.machine.voice.data.backup.BackupAndWipeManager
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.OwnerSettings
import com.machine.voice.data.prefs.RetentionWindow
import com.machine.voice.data.prefs.VoiceInputLocale
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun SettingsScreen(
    settings: OwnerSettings,
    permissionSnapshot: PermissionSnapshot,
    onSelectLanguage: (AppLanguage) -> Unit,
    onSelectVoiceLocale: (VoiceInputLocale) -> Unit,
    onUpdateVoiceTuning: (Float, Float) -> Unit,
    onTestVoice: () -> Unit,
    onSelectRetention: (RetentionWindow) -> Unit,
    onToggleAiEnabled: (Boolean) -> Unit,
    onSaveGeminiKey: (String) -> Unit,
    onClearGeminiKey: () -> Unit,
    onToggleFloatingMic: (Boolean) -> Unit,
    onToggleWakeWord: (Boolean) -> Unit,
    onRequestMicPermission: () -> Unit,
    onOpenOverlaySettings: () -> Unit,
    onOpenPermissions: () -> Unit,
    onOpenBriefing: () -> Unit,
    onDataWiped: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    var rateDraft by remember(settings.voiceRate) { mutableFloatStateOf(settings.voiceRate) }
    var pitchDraft by remember(settings.voicePitch) { mutableFloatStateOf(settings.voicePitch) }
    var keyDraft by remember { mutableStateOf("") }
    var showKeyEditor by remember { mutableStateOf(false) }
    var statusBanner by remember { mutableStateOf<String?>(null) }
    var showWipeConfirmDialog by remember { mutableStateOf(false) }

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val json = BackupAndWipeManager.exportBackupJson(context)
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri)?.use { out ->
                        out.write(json.toByteArray(Charsets.UTF_8))
                    } ?: error("Unable to open destination file.")
                }
                statusBanner = "Backup exported cleanly (API key excluded for safety)."
            } catch (e: Exception) {
                statusBanner = "Export failed: ${e.message ?: "unknown error"}"
            }
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val raw = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)
                        ?.use { it.readText() }
                        ?: error("Unable to read selected file.")
                }
                val result = BackupAndWipeManager.importBackupJson(context, raw)
                statusBanner = "Imported ${result.appRulesImported} app rules, " +
                    "${result.contactRulesImported} contact rules, ${result.callerTagsImported} caller tags, " +
                    "and ${result.remindersImported} reminders."
            } catch (e: Exception) {
                statusBanner = "Import failed: ${e.message ?: "invalid backup file"}"
            }
        }
    }

    if (showWipeConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showWipeConfirmDialog = false },
            containerColor = CharcoalPanel,
            title = {
                Text(
                    text = "DELETE ALL LOCAL DATA?",
                    style = MaterialTheme.typography.headlineSmall.copy(color = CrimsonAlert)
                )
            },
            text = {
                Text(
                    text = "This permanently deletes all notification logs, app/contact rules, caller ID tags, reminders, scheduled alarms, voice transcript, and your encrypted Gemini API key from this phone.",
                    style = MaterialTheme.typography.bodyMedium.copy(color = IvoryText)
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showWipeConfirmDialog = false
                        scope.launch {
                            BackupAndWipeManager.wipeAllLocalData(context)
                            onDataWiped()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = CrimsonAlert,
                        contentColor = IvoryText
                    )
                ) {
                    Text("DELETE EVERYTHING")
                }
            },
            dismissButton = {
                TextButton(onClick = { showWipeConfirmDialog = false }) {
                    Text("CANCEL", color = ChampagneGold)
                }
            }
        )
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
                    text = "SETTINGS & PRIVACY",
                    style = MaterialTheme.typography.headlineMedium
                )
                Text(
                    text = "Single-owner · Encrypted prefs · Local SQLite",
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

        if (!statusBanner.isNullOrBlank()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(1.dp, ChampagneGold),
                shape = RoundedCornerShape(10.dp)
            ) {
                Text(
                    text = statusBanner!!,
                    style = MaterialTheme.typography.bodyMedium.copy(color = ChampagneGold),
                    modifier = Modifier.padding(12.dp)
                )
            }
        }

        // Language & Voice Tuning Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("LANGUAGE & VOICE PROFILE", style = MaterialTheme.typography.titleMedium)

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AppLanguage.entries.forEach { lang ->
                        val selected = settings.language == lang
                        OutlinedButton(
                            onClick = { onSelectLanguage(lang) },
                            border = BorderStroke(
                                if (selected) 1.5.dp else 1.dp,
                                if (selected) ChampagneGold else GoldBorder
                            ),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (selected) ObsidianElevated else ObsidianBlack
                            ),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f).height(42.dp)
                        ) {
                            Text(
                                text = lang.label.uppercase(),
                                color = if (selected) ChampagneGold else MutedIvory
                            )
                        }
                    }
                }

                Text("Speech Recognition Locale", style = MaterialTheme.typography.bodyMedium)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    VoiceInputLocale.entries.forEach { loc ->
                        val selected = settings.voiceInputLocale == loc
                        OutlinedButton(
                            onClick = { onSelectVoiceLocale(loc) },
                            border = BorderStroke(
                                if (selected) 1.5.dp else 1.dp,
                                if (selected) ChampagneGold else GoldBorder
                            ),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (selected) ObsidianElevated else ObsidianBlack
                            ),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f).height(40.dp)
                        ) {
                            Text(
                                text = loc.label,
                                style = MaterialTheme.typography.labelSmall.copy(
                                    color = if (selected) ChampagneGold else MutedIvory
                                )
                            )
                        }
                    }
                }

                Text(
                    text = "Speech Speed: ${String.format(Locale.US, "%.2fx", rateDraft)}",
                    style = MaterialTheme.typography.bodyMedium
                )
                Slider(
                    value = rateDraft,
                    onValueChange = { rateDraft = it },
                    onValueChangeFinished = { onUpdateVoiceTuning(rateDraft, pitchDraft) },
                    valueRange = 0.65f..1.55f,
                    colors = SliderDefaults.colors(
                        thumbColor = ChampagneGold,
                        activeTrackColor = MetallicGold
                    )
                )

                Text(
                    text = "Voice Pitch: ${String.format(Locale.US, "%.2f", pitchDraft)}",
                    style = MaterialTheme.typography.bodyMedium
                )
                Slider(
                    value = pitchDraft,
                    onValueChange = { pitchDraft = it },
                    onValueChangeFinished = { onUpdateVoiceTuning(rateDraft, pitchDraft) },
                    valueRange = 0.7f..1.4f,
                    colors = SliderDefaults.colors(
                        thumbColor = ChampagneGold,
                        activeTrackColor = MetallicGold
                    )
                )

                OutlinedButton(
                    onClick = onTestVoice,
                    border = BorderStroke(1.dp, MetallicGold),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(44.dp)
                ) {
                    Icon(Icons.Default.VolumeUp, contentDescription = null, tint = MetallicGold, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("TEST SPEAKING VOICE", color = MetallicGold)
                }
            }
        }

        // Data Retention & Security Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("PRIVACY & AUTO-RETENTION", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = "All data stays on this phone (android:allowBackup=false, EncryptedSharedPreferences AES-256). OTPs and PIN codes are never spoken or sent to Gemini.",
                    style = MaterialTheme.typography.bodyMedium
                )

                Text("Notification Log Auto-Delete Window", style = MaterialTheme.typography.bodyLarge)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    RetentionWindow.entries.forEach { win ->
                        val selected = settings.retentionWindow == win
                        OutlinedButton(
                            onClick = {
                                onSelectRetention(win)
                                scope.launch {
                                    BackupAndWipeManager.enforceRetentionNow(context)
                                    statusBanner = "Retention updated to ${win.labelEn}; older logs pruned."
                                }
                            },
                            border = BorderStroke(
                                if (selected) 1.5.dp else 1.dp,
                                if (selected) ChampagneGold else GoldBorder
                            ),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (selected) ObsidianElevated else ObsidianBlack
                            ),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f).height(40.dp)
                        ) {
                            Text(
                                text = win.labelEn,
                                style = MaterialTheme.typography.labelSmall.copy(
                                    color = if (selected) ChampagneGold else MutedIvory
                                )
                            )
                        }
                    }
                }

                OutlinedButton(
                    onClick = {
                        scope.launch {
                            BackupAndWipeManager.enforceRetentionNow(context)
                            statusBanner = "Expired notification logs cleaned up."
                        }
                    },
                    border = BorderStroke(1.dp, GoldBorder),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(42.dp)
                ) {
                    Icon(Icons.Default.CleaningServices, contentDescription = null, tint = ChampagneGold, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("PRUNE EXPIRED LOGS NOW", color = ChampagneGold)
                }
            }
        }

        // Gemini AI Key & Cloud Opt-In Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
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
                    Column(modifier = Modifier.weight(1f)) {
                        Text("GEMINI CLOUD AI (OPTIONAL)", style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = if (settings.hasGeminiKey) {
                                "Encrypted owner key saved on device."
                            } else {
                                "Off or no key saved. Device commands still run offline."
                            },
                            style = MaterialTheme.typography.bodyMedium.copy(
                                color = if (settings.hasGeminiKey) EmeraldGranted else MutedIvory
                            )
                        )
                    }
                    Switch(
                        checked = settings.aiEnabled,
                        onCheckedChange = {
                            onToggleAiEnabled(it)
                            if (it && !settings.hasGeminiKey) showKeyEditor = true
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = ObsidianBlack,
                            checkedTrackColor = MetallicGold
                        )
                    )
                }

                if (settings.aiEnabled) {
                    if (showKeyEditor || !settings.hasGeminiKey) {
                        OutlinedTextField(
                            value = keyDraft,
                            onValueChange = { keyDraft = it },
                            label = { Text("Enter owner Gemini API key") },
                            visualTransformation = PasswordVisualTransformation(),
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
                                    if (keyDraft.isNotBlank()) {
                                        onSaveGeminiKey(keyDraft)
                                        keyDraft = ""
                                        showKeyEditor = false
                                        statusBanner = "Gemini API key encrypted and saved locally."
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MetallicGold,
                                    contentColor = ObsidianBlack
                                ),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Default.Key, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("SAVE KEY")
                            }
                            if (settings.hasGeminiKey) {
                                OutlinedButton(
                                    onClick = { showKeyEditor = false },
                                    border = BorderStroke(1.dp, GoldBorder)
                                ) {
                                    Text("DONE", color = ChampagneGold)
                                }
                            }
                        }
                    } else {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = { showKeyEditor = true },
                                border = BorderStroke(1.dp, MetallicGold),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("REPLACE KEY", color = MetallicGold)
                            }
                            OutlinedButton(
                                onClick = {
                                    onClearGeminiKey()
                                    showKeyEditor = true
                                    statusBanner = "Saved Gemini API key removed."
                                },
                                border = BorderStroke(1.dp, CrimsonAlert),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("REMOVE KEY", color = CrimsonAlert)
                            }
                        }
                    }
                }
            }
        }

        // System-Wide Shortcuts Card (Floating Mic, Wake Word, Permissions, Briefing)
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("SYSTEM INTEGRATIONS", style = MaterialTheme.typography.titleMedium)

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Floating Gold Mic Button", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            if (permissionSnapshot.overlay) "Show over other apps." else "Grant Display over other apps first.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    Switch(
                        checked = settings.floatingMicEnabled && permissionSnapshot.overlay,
                        onCheckedChange = { want ->
                            if (want && !permissionSnapshot.overlay) onOpenOverlaySettings()
                            else onToggleFloatingMic(want)
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = ObsidianBlack,
                            checkedTrackColor = MetallicGold
                        )
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Optional \"Hey Machine\" Wake Word", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Higher battery use when enabled.",
                            style = MaterialTheme.typography.bodyMedium.copy(color = AmberWarning)
                        )
                    }
                    Switch(
                        checked = settings.wakeWordEnabled && permissionSnapshot.microphone,
                        onCheckedChange = { want ->
                            if (want && !permissionSnapshot.microphone) onRequestMicPermission()
                            else onToggleWakeWord(want)
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = ObsidianBlack,
                            checkedTrackColor = MetallicGold
                        )
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onOpenBriefing,
                        border = BorderStroke(1.dp, GoldBorder),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("BRIEFING SCHEDULE", color = ChampagneGold, style = MaterialTheme.typography.labelSmall)
                    }
                    OutlinedButton(
                        onClick = onOpenPermissions,
                        border = BorderStroke(1.dp, GoldBorder),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("PERMISSIONS (${permissionSnapshot.coreReadyCount}/${permissionSnapshot.coreTotalCount})", color = ChampagneGold, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }

        // Export / Import Backup Card
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, ChampagneGold.copy(alpha = 0.65f)),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("BACKUP & PORTABILITY (JSON)", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = "Export rules, caller tags, reminders, and settings to a JSON file on your phone (Gemini API key is excluded for safety).",
                    style = MaterialTheme.typography.bodyMedium
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = {
                            val dateStamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date())
                            exportLauncher.launch("machine-voice-backup-$dateStamp.json")
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MetallicGold,
                            contentColor = ObsidianBlack
                        ),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(46.dp)
                    ) {
                        Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("EXPORT")
                    }

                    OutlinedButton(
                        onClick = {
                            importLauncher.launch(arrayOf("application/json", "text/*", "*/*"))
                        },
                        border = BorderStroke(1.dp, MetallicGold),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(46.dp)
                    ) {
                        Icon(Icons.Default.Upload, contentDescription = null, tint = MetallicGold, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("IMPORT", color = MetallicGold)
                    }
                }
            }
        }

        // Danger Zone — Full Local Wipe
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, CrimsonAlert),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "DELETE ALL MY DATA",
                    style = MaterialTheme.typography.titleMedium.copy(color = CrimsonAlert)
                )
                Text(
                    text = "Permanently wipe all logs, rules, caller tags, reminders, alarms, and encrypted API keys from this device.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Button(
                    onClick = { showWipeConfirmDialog = true },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = CrimsonAlert,
                        contentColor = IvoryText
                    ),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                ) {
                    Icon(Icons.Default.DeleteForever, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("DELETE ALL DATA NOW", style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}
