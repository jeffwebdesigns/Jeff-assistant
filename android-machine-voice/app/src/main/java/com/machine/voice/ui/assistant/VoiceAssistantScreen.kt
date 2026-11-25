package com.machine.voice.ui.assistant

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Stop
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.machine.voice.ai.PendingVoiceAction
import com.machine.voice.ai.VoiceTurn
import com.machine.voice.data.prefs.OwnerSettings
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun VoiceAssistantScreen(
    settings: OwnerSettings,
    permissionSnapshot: PermissionSnapshot,
    turns: List<VoiceTurn>,
    pendingAction: PendingVoiceAction?,
    isListening: Boolean,
    isThinking: Boolean,
    isSpeaking: Boolean,
    partialTranscript: String,
    speechError: String?,
    onStartListening: () -> Unit,
    onStopListening: () -> Unit,
    onSubmitText: (String) -> Unit,
    onConfirmPending: () -> Unit,
    onCancelPending: () -> Unit,
    onSpeakText: (String) -> Unit,
    onStopSpeaking: () -> Unit,
    onClearTranscript: () -> Unit,
    onSelectVoiceLocale: (VoiceInputLocale) -> Unit,
    onToggleAiEnabled: (Boolean) -> Unit,
    onSaveGeminiKey: (String) -> Unit,
    onClearGeminiKey: () -> Unit,
    onToggleFloatingMic: (Boolean) -> Unit,
    onToggleWakeWord: (Boolean) -> Unit,
    onRequestMicPermission: () -> Unit,
    onOpenOverlaySettings: () -> Unit
) {
    val scrollState = rememberScrollState()
    var typedInput by remember { mutableStateOf("") }
    var keyDraft by remember { mutableStateOf("") }
    var showKeyEditor by remember { mutableStateOf(!settings.hasGeminiKey && settings.aiEnabled) }

    val pulseTransition = rememberInfiniteTransition(label = "micPulse")
    val pulseScale by pulseTransition.animateFloat(
        initialValue = 1.0f,
        targetValue = 1.12f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 750),
            repeatMode = RepeatMode.Reverse
        ),
        label = "micScale"
    )

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
            Column {
                Text(
                    text = "VOICE ASSISTANT",
                    style = MaterialTheme.typography.headlineMedium
                )
                Text(
                    text = when {
                        settings.aiEnabled && settings.hasGeminiKey -> "GEMINI Q&A + DEVICE COMMANDS"
                        settings.aiEnabled -> "GEMINI ON · ENTER API KEY BELOW"
                        else -> "100% ON-DEVICE COMMAND MODE"
                    },
                    style = MaterialTheme.typography.labelSmall.copy(
                        color = if (settings.aiEnabled && settings.hasGeminiKey) EmeraldGranted else MetallicGold
                    )
                )
            }
            if (turns.isNotEmpty()) {
                IconButton(onClick = onClearTranscript) {
                    Icon(
                        imageVector = Icons.Default.DeleteOutline,
                        contentDescription = "Clear conversation",
                        tint = MutedIvory
                    )
                }
            }
        }

        // Speech-to-Text Locale Selector (EN-KE / EN-US / SW-KE)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            VoiceInputLocale.entries.forEach { locale ->
                val selected = settings.voiceInputLocale == locale
                OutlinedButton(
                    onClick = { onSelectVoiceLocale(locale) },
                    border = BorderStroke(
                        width = if (selected) 1.5.dp else 1.dp,
                        color = if (selected) ChampagneGold else GoldBorder
                    ),
                    colors = ButtonDefaults.outlinedButtonColors(
                        containerColor = if (selected) CharcoalPanel else ObsidianBlack,
                        contentColor = if (selected) ChampagneGold else MutedIvory
                    ),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.weight(1f).height(40.dp)
                ) {
                    Text(
                        text = locale.label,
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = if (selected) ChampagneGold else MutedIvory
                        )
                    )
                }
            }
        }

        HorizontalDivider(color = GoldBorder)

        // Pending Read-Back Confirmation Card (Mandatory before Reply / Reminder / Call)
        if (pendingAction != null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
                border = BorderStroke(2.dp, ChampagneGold),
                shape = RoundedCornerShape(14.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = pendingAction.title,
                        style = MaterialTheme.typography.titleMedium.copy(color = ChampagneGold)
                    )
                    Text(
                        text = pendingAction.readBackSummary,
                        style = MaterialTheme.typography.bodyLarge.copy(color = IvoryText)
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Button(
                            onClick = onConfirmPending,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MetallicGold,
                                contentColor = ObsidianBlack
                            ),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f).height(48.dp)
                        ) {
                            Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("CONFIRM", style = MaterialTheme.typography.labelLarge)
                        }
                        OutlinedButton(
                            onClick = onCancelPending,
                            border = BorderStroke(1.dp, CrimsonAlert),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f).height(48.dp)
                        ) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = null,
                                tint = CrimsonAlert,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("CANCEL", color = CrimsonAlert)
                        }
                    }
                }
            }
        }

        // Central Pulsing Metallic Gold Mic Orb
        Card(
            colors = CardDefaults.cardColors(containerColor = CharcoalPanel),
            border = BorderStroke(1.dp, GoldBorder),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(92.dp)
                        .scale(if (isListening) pulseScale else 1f)
                        .clip(CircleShape)
                        .background(if (isListening) ChampagneGold else MetallicGold)
                        .clickable {
                            if (!permissionSnapshot.microphone) {
                                onRequestMicPermission()
                            } else if (isListening) {
                                onStopListening()
                            } else {
                                onStartListening()
                            }
                        }
                ) {
                    Icon(
                        imageVector = if (isListening) Icons.Default.Stop else Icons.Default.Mic,
                        contentDescription = if (isListening) "Stop listening" else "Tap to speak",
                        tint = ObsidianBlack,
                        modifier = Modifier.size(40.dp)
                    )
                }

                Text(
                    text = when {
                        !permissionSnapshot.microphone -> "Microphone access needed · Tap orb to grant"
                        isListening -> "LISTENING (${settings.voiceInputLocale.label}) · TAP TO STOP"
                        isThinking -> "THINKING..."
                        isSpeaking -> "SPEAKING RESPONSE..."
                        else -> "TAP GOLD MIC OR TYPE ANY QUESTION"
                    },
                    style = MaterialTheme.typography.labelSmall.copy(
                        color = if (isListening) ChampagneGold else IvoryText
                    )
                )

                if (partialTranscript.isNotBlank() && isListening) {
                    Text(
                        text = "\"$partialTranscript\"",
                        style = MaterialTheme.typography.bodyLarge.copy(color = ChampagneGold)
                    )
                }

                if (!speechError.isNullOrBlank()) {
                    Text(
                        text = speechError,
                        style = MaterialTheme.typography.bodyMedium.copy(color = AmberWarning)
                    )
                }

                if (isSpeaking) {
                    OutlinedButton(
                        onClick = onStopSpeaking,
                        border = BorderStroke(1.dp, CrimsonAlert),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth().height(42.dp)
                    ) {
                        Icon(
                            Icons.Default.Stop,
                            contentDescription = null,
                            tint = CrimsonAlert,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("STOP AUDIO", color = CrimsonAlert)
                    }
                }
            }
        }

        // Text Command / Question Input Bar
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = typedInput,
                onValueChange = { typedInput = it },
                placeholder = { Text("Ask anything or give a command...") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MetallicGold,
                    unfocusedBorderColor = GoldBorder,
                    focusedTextColor = IvoryText,
                    unfocusedTextColor = IvoryText
                ),
                modifier = Modifier.weight(1f)
            )
            Button(
                onClick = {
                    val q = typedInput.trim()
                    if (q.isNotEmpty()) {
                        typedInput = ""
                        onSubmitText(q)
                    }
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MetallicGold,
                    contentColor = ObsidianBlack
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.height(54.dp)
            ) {
                Icon(Icons.Default.Send, contentDescription = "Send")
            }
        }

        // Quick Sample Command Chips (scrollable row)
        val samplePrompts = listOf(
            "Read my messages",
            "Who called today?",
            "Set a reminder for 5pm",
            "Briefing",
            "Explain M-Pesa Paybill vs Till"
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            samplePrompts.forEach { sample ->
                OutlinedButton(
                    onClick = { onSubmitText(sample) },
                    border = BorderStroke(1.dp, GoldBorder),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.height(38.dp)
                ) {
                    Text(sample, color = ChampagneGold, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        // Conversation Transcript
        if (turns.isNotEmpty()) {
            Text(
                text = "CONVERSATION",
                style = MaterialTheme.typography.titleMedium
            )
            turns.reversed().forEach { turn ->
                TurnBubbleCard(
                    turn = turn,
                    onSpeak = { onSpeakText(turn.text) }
                )
            }
        }

        // Gemini Q&A & Key Configuration Card (EncryptedSharedPreferences)
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
                        Text(
                            text = "GEMINI AI QUESTION ENGINE",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = if (settings.hasGeminiKey) {
                                "Owner API key saved securely on device."
                            } else {
                                "Optional: add your Gemini key to answer general questions."
                            },
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    Switch(
                        checked = settings.aiEnabled,
                        onCheckedChange = {
                            onToggleAiEnabled(it)
                            if (it && !settings.hasGeminiKey) {
                                showKeyEditor = true
                            }
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
                            label = { Text("Paste Gemini API Key (stored encrypted)") },
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

        // System-Wide Voice Triggers Card (Floating Gold Mic & Optional Wake Word)
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
                    text = "SYSTEM-WIDE VOICE TRIGGERS",
                    style = MaterialTheme.typography.titleMedium
                )

                // Floating Gold Mic Switch
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Floating Gold Mic Button",
                            style = MaterialTheme.typography.bodyLarge
                        )
                        Text(
                            text = if (permissionSnapshot.overlay) {
                                "Draggable gold mic orb visible over other apps."
                            } else {
                                "Requires 'Display over other apps' permission."
                            },
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    Switch(
                        checked = settings.floatingMicEnabled && permissionSnapshot.overlay,
                        onCheckedChange = { want ->
                            if (want && !permissionSnapshot.overlay) {
                                onOpenOverlaySettings()
                            } else {
                                onToggleFloatingMic(want)
                            }
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = ObsidianBlack,
                            checkedTrackColor = MetallicGold
                        )
                    )
                }

                HorizontalDivider(color = GoldBorder)

                // Optional Wake Word Switch with clear battery cost notice
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Optional \"Hey Machine\" Wake Word",
                            style = MaterialTheme.typography.bodyLarge
                        )
                        Text(
                            text = "Uses extra battery by keeping a foreground listener active. Recommended off unless driving or hands-free.",
                            style = MaterialTheme.typography.bodyMedium.copy(color = AmberWarning)
                        )
                    }
                    Switch(
                        checked = settings.wakeWordEnabled && permissionSnapshot.microphone,
                        onCheckedChange = { want ->
                            if (want && !permissionSnapshot.microphone) {
                                onRequestMicPermission()
                            } else {
                                onToggleWakeWord(want)
                            }
                        },
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
private fun TurnBubbleCard(
    turn: VoiceTurn,
    onSpeak: () -> Unit
) {
    val timeLabel = remember(turn.timestamp) {
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(turn.timestamp))
    }
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (turn.isOwner) ObsidianElevated else CharcoalPanel
        ),
        border = BorderStroke(
            width = 1.dp,
            color = if (turn.isOwner) GoldBorder else ChampagneGold.copy(alpha = 0.5f)
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val roleLabel = if (turn.isOwner) "OWNER" else "MACHINE"
                val suffix = turn.badge?.let { " · $it" }.orEmpty()
                Text(
                    text = "$roleLabel$suffix · $timeLabel",
                    style = MaterialTheme.typography.labelSmall.copy(
                        color = if (turn.isOwner) MutedIvory else ChampagneGold
                    )
                )
                if (!turn.isOwner) {
                    IconButton(
                        onClick = onSpeak,
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.VolumeUp,
                            contentDescription = "Speak answer again",
                            tint = MetallicGold,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
            Text(
                text = turn.text,
                style = MaterialTheme.typography.bodyLarge.copy(color = IvoryText)
            )
        }
    }
}
