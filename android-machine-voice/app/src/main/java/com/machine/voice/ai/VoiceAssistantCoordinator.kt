package com.machine.voice.ai

import android.Manifest
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.machine.voice.briefing.BriefingGenerator
import com.machine.voice.calls.LocalCallerIdResolver
import com.machine.voice.data.local.MachineDatabase
import com.machine.voice.data.local.NotificationLogEntity
import com.machine.voice.data.local.ReminderEntity
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.SecurePrefs
import com.machine.voice.notifications.LanguageDetector
import com.machine.voice.reminders.ReminderScheduler
import com.machine.voice.service.NotificationReplyCache
import com.machine.voice.speech.SpeechQueueManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.time.LocalDate
import java.time.ZoneId
import java.util.Date
import java.util.Locale
import java.util.UUID

data class VoiceTurn(
    val id: String = UUID.randomUUID().toString(),
    val isOwner: Boolean,
    val text: String,
    val badge: String? = null,
    val usedCloudAi: Boolean = false,
    val timestamp: Long = System.currentTimeMillis()
)

sealed class PendingVoiceAction {
    abstract val title: String
    abstract val readBackSummary: String

    data class SendReply(
        val sender: String,
        val appName: String,
        val replyText: String,
        val targetLookupKey: String,
        override val title: String,
        override val readBackSummary: String
    ) : PendingVoiceAction()

    data class CreateReminder(
        val reminderTitle: String,
        val triggerAtMillis: Long,
        val isMeeting: Boolean,
        override val title: String,
        override val readBackSummary: String
    ) : PendingVoiceAction()

    data class PlaceCall(
        val displayName: String,
        val phoneNumber: String,
        override val title: String,
        override val readBackSummary: String
    ) : PendingVoiceAction()
}

class VoiceAssistantCoordinator private constructor(private val appContext: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val securePrefs = SecurePrefs(appContext)
    private val database = MachineDatabase.getInstance(appContext)
    private val speechQueue = SpeechQueueManager.getInstance(appContext)
    private val localParser = LocalCommandParser()
    private val aiProvider: VoiceAiProvider = GeminiRestVoiceProvider(securePrefs, localParser)

    private val _turns = MutableStateFlow<List<VoiceTurn>>(emptyList())
    val turns: StateFlow<List<VoiceTurn>> = _turns.asStateFlow()

    private val _pendingAction = MutableStateFlow<PendingVoiceAction?>(null)
    val pendingAction: StateFlow<PendingVoiceAction?> = _pendingAction.asStateFlow()

    private val _isThinking = MutableStateFlow(false)
    val isThinking: StateFlow<Boolean> = _isThinking.asStateFlow()

    fun submitInput(rawInput: String, speakReply: Boolean = true) {
        val text = rawInput.trim()
        if (text.isEmpty()) return

        val settings = securePrefs.settings.value
        val activePending = _pendingAction.value

        if (activePending != null) {
            val lower = text.lowercase()
            if (isConfirmationPhrase(lower)) {
                appendTurn(VoiceTurn(isOwner = true, text = text, badge = "CONFIRM"))
                confirmPendingAction(speakReply = speakReply)
                return
            }
            if (isCancellationPhrase(lower)) {
                appendTurn(VoiceTurn(isOwner = true, text = text, badge = "CANCEL"))
                cancelPendingAction(speakReply = speakReply)
                return
            }
        }

        appendTurn(VoiceTurn(isOwner = true, text = text))

        scope.launch {
            _isThinking.value = true
            try {
                val replyLang = LanguageDetector.detectLanguage(text, settings.language)
                val contextSnapshot = withContext(Dispatchers.IO) { buildLocalContext() }
                val response = aiProvider.interpretAndAnswer(
                    prompt = text,
                    localContext = contextSnapshot,
                    preferredLang = replyLang
                )
                handleAiResponse(response, replyLang, speakReply)
            } finally {
                _isThinking.value = false
            }
        }
    }

    fun confirmPendingAction(speakReply: Boolean = true) {
        val action = _pendingAction.value ?: return
        _pendingAction.value = null
        val lang = securePrefs.settings.value.language

        scope.launch {
            when (action) {
                is PendingVoiceAction.SendReply -> {
                    val handle = if (action.targetLookupKey == "last") {
                        NotificationReplyCache.latestReplyable
                    } else {
                        NotificationReplyCache.findForSender(action.targetLookupKey)
                            ?: NotificationReplyCache.latestReplyable?.takeIf {
                                it.sender.equals(action.sender, ignoreCase = true)
                            }
                    }

                    if (handle == null) {
                        val msg = if (lang == AppLanguage.SWAHILI) {
                            "Kitendo cha kujibu hakipatikani tena kutoka kwenye arifa. Fungua ${action.appName} kujibu."
                        } else {
                            "The notification reply handle is no longer active. Open ${action.appName} directly to send."
                        }
                        postAssistantReply(msg, badge = "REPLY EXPIRED", lang = lang, speak = speakReply)
                        return@launch
                    }

                    val sent = withContext(Dispatchers.IO) {
                        try {
                            val resultsBundle = Bundle().apply {
                                putCharSequence(handle.remoteInput.resultKey, action.replyText)
                            }
                            val fillIntent = Intent()
                            RemoteInput.addResultsToIntent(
                                arrayOf(handle.remoteInput),
                                fillIntent,
                                resultsBundle
                            )
                            handle.replyIntent.send(appContext, 0, fillIntent)
                            true
                        } catch (_: Exception) {
                            false
                        }
                    }

                    val msg = if (sent) {
                        if (lang == AppLanguage.SWAHILI) {
                            "Jibu limetumwa kwa ${action.sender} kwenye ${action.appName}."
                        } else {
                            "Reply sent to ${action.sender} on ${action.appName}."
                        }
                    } else {
                        if (lang == AppLanguage.SWAHILI) {
                            "Imeshindwa kutuma jibu la moja kwa moja kwa ${action.sender}."
                        } else {
                            "Could not deliver direct reply to ${action.sender}. Try opening ${action.appName}."
                        }
                    }
                    postAssistantReply(msg, badge = if (sent) "SENT" else "FAILED", lang = lang, speak = speakReply)
                }

                is PendingVoiceAction.CreateReminder -> {
                    withContext(Dispatchers.IO) {
                        val draft = ReminderEntity(
                            title = action.reminderTitle,
                            triggerAtMillis = action.triggerAtMillis,
                            isMeeting = action.isMeeting
                        )
                        val rowId = database.reminderDao().upsert(draft)
                        ReminderScheduler.scheduleReminder(appContext, draft.copy(id = rowId))
                    }
                    val fmt = SimpleDateFormat("EEE dd MMM, HH:mm", Locale.getDefault())
                        .format(Date(action.triggerAtMillis))
                    val msg = if (lang == AppLanguage.SWAHILI) {
                        "Kikumbusho kimehifadhiwa: ${action.reminderTitle}, saa $fmt."
                    } else {
                        "Saved: ${action.reminderTitle} for $fmt."
                    }
                    postAssistantReply(msg, badge = "SAVED", lang = lang, speak = speakReply)
                }

                is PendingVoiceAction.PlaceCall -> {
                    val hasDirectCall = ContextCompat.checkSelfPermission(
                        appContext,
                        Manifest.permission.CALL_PHONE
                    ) == PackageManager.PERMISSION_GRANTED

                    val intentAction = if (hasDirectCall) Intent.ACTION_CALL else Intent.ACTION_DIAL
                    val dialIntent = Intent(
                        intentAction,
                        Uri.parse("tel:${Uri.encode(action.phoneNumber)}")
                    ).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    try {
                        appContext.startActivity(dialIntent)
                        val msg = if (hasDirectCall) {
                            if (lang == AppLanguage.SWAHILI) {
                                "Ninapiga simu kwa ${action.displayName}."
                            } else {
                                "Calling ${action.displayName}."
                            }
                        } else {
                            if (lang == AppLanguage.SWAHILI) {
                                "Ninafungua kipiga simu kwa ${action.displayName}."
                            } else {
                                "Opening dialer for ${action.displayName}."
                            }
                        }
                        postAssistantReply(msg, badge = "CALLING", lang = lang, speak = speakReply)
                    } catch (_: Exception) {
                        postAssistantReply(
                            "Unable to start call for ${action.displayName}.",
                            badge = "CALL FAILED",
                            lang = lang,
                            speak = speakReply
                        )
                    }
                }
            }
        }
    }

    fun cancelPendingAction(speakReply: Boolean = true) {
        if (_pendingAction.value == null) return
        _pendingAction.value = null
        val lang = securePrefs.settings.value.language
        val msg = if (lang == AppLanguage.SWAHILI) {
            "Sawa, nimeghairi."
        } else {
            "Cancelled. No action taken."
        }
        postAssistantReply(msg, badge = "CANCELLED", lang = lang, speak = speakReply)
    }

    fun speakText(text: String) {
        val lang = LanguageDetector.detectLanguage(text, securePrefs.settings.value.language)
        speechQueue.enqueue(text = text, language = lang, pauseDuringCall = false)
    }

    fun clearTranscript() {
        _turns.value = emptyList()
        _pendingAction.value = null
    }

    private suspend fun handleAiResponse(
        response: VoiceAiResponse,
        lang: AppLanguage,
        speakReply: Boolean
    ) {
        when (response.intentType) {
            VoiceIntentType.STOP_SPEAKING -> {
                speechQueue.stopAll()
                val msg = if (lang == AppLanguage.SWAHILI) "Nimeacha." else "Audio silenced."
                postAssistantReply(msg, badge = "STOP", lang = lang, speak = false)
            }

            VoiceIntentType.READ_MESSAGES -> {
                val recent = withContext(Dispatchers.IO) {
                    database.notificationLogDao().listRecent(6)
                }
                if (recent.isEmpty()) {
                    val msg = if (lang == AppLanguage.SWAHILI) {
                        "Hakuna ujumbe mpya uliohifadhiwa hivi sasa."
                    } else {
                        "No recent messages are logged yet."
                    }
                    postAssistantReply(msg, badge = "INBOX", lang = lang, speak = speakReply)
                    return
                }
                val summaryLines = recent.take(5).map { item ->
                    if (item.isSensitiveShielded) {
                        if (lang == AppLanguage.SWAHILI) {
                            "Ujumbe wa namba ya siri kwenye ${item.appName}."
                        } else {
                            "Verification code received on ${item.appName}."
                        }
                    } else {
                        if (lang == AppLanguage.SWAHILI) {
                            "${item.sender} kwenye ${item.appName}: ${item.previewText}."
                        } else {
                            "${item.sender} on ${item.appName}: ${item.previewText}."
                        }
                    }
                }
                val spoken = if (lang == AppLanguage.SWAHILI) {
                    "Ujumbe wa hivi karibuni: " + summaryLines.joinToString(" ")
                } else {
                    "Here are your latest messages. " + summaryLines.joinToString(" ")
                }
                postAssistantReply(spoken, badge = "INBOX", lang = lang, speak = speakReply)
            }

            VoiceIntentType.READ_SENDER -> {
                val target = response.targetName.orEmpty().trim()
                val matches = withContext(Dispatchers.IO) {
                    if (target.isEmpty()) {
                        emptyList()
                    } else {
                        database.notificationLogDao().findBySender(target)
                    }
                }
                if (matches.isEmpty()) {
                    val msg = if (lang == AppLanguage.SWAHILI) {
                        "Sijaona ujumbe wowote kutoka kwa $target kwenye kumbukumbu za hivi karibuni."
                    } else {
                        "I found no recent messages from $target in your local log."
                    }
                    postAssistantReply(msg, badge = "SENDER", lang = lang, speak = speakReply)
                    return
                }
                val latest = matches.first()
                val msg = formatNotificationForSpeech(latest, full = true, lang = lang)
                postAssistantReply(msg, badge = latest.sender.uppercase(), lang = lang, speak = speakReply)
            }

            VoiceIntentType.READ_FULL_LAST -> {
                val latest = withContext(Dispatchers.IO) {
                    database.notificationLogDao().listRecent(1).firstOrNull()
                }
                if (latest == null) {
                    val msg = if (lang == AppLanguage.SWAHILI) {
                        "Hakuna ujumbe wa kusoma kikamilifu."
                    } else {
                        "No logged message is available to read."
                    }
                    postAssistantReply(msg, badge = "READ FULL", lang = lang, speak = speakReply)
                    return
                }
                val msg = formatNotificationForSpeech(latest, full = true, lang = lang)
                postAssistantReply(msg, badge = "READ FULL", lang = lang, speak = speakReply)
            }

            VoiceIntentType.WHO_CALLED_TODAY -> {
                val todayCalls = withContext(Dispatchers.IO) { fetchTodayCalls() }
                val msg = if (todayCalls.isEmpty()) {
                    if (lang == AppLanguage.SWAHILI) {
                        "Hakuna simu zilizorekodiwa leo, au ruhusa ya kumbukumbu za simu haijatolewa."
                    } else {
                        "No calls logged today, or Call Log permission is not granted."
                    }
                } else {
                    val parts = todayCalls.take(6).map { entry ->
                        val who = entry.contactName ?: entry.rawNumber
                        val tag = entry.tagLabel?.let { " ($it)" }.orEmpty()
                        "$who$tag, ${entry.callTypeLabel}"
                    }
                    if (lang == AppLanguage.SWAHILI) {
                        "Simu za leo: ${parts.joinToString(". ")}."
                    } else {
                        "Today's callers: ${parts.joinToString(". ")}."
                    }
                }
                postAssistantReply(msg, badge = "CALLS TODAY", lang = lang, speak = speakReply)
            }

            VoiceIntentType.OPEN_BRIEFING -> {
                val report = BriefingGenerator.generate(appContext, allowCloudPolish = true)
                postAssistantReply(
                    text = report.spokenScript,
                    badge = if (report.usedCloudAi) "BRIEFING · GEMINI" else "BRIEFING",
                    lang = lang,
                    usedCloudAi = report.usedCloudAi,
                    speak = speakReply
                )
            }

            VoiceIntentType.REPLY_MESSAGE -> {
                val targetRaw = response.targetName?.trim().orEmpty().ifEmpty { "last" }
                val replyBody = response.replyText?.trim().orEmpty()
                if (replyBody.isEmpty()) {
                    val msg = if (lang == AppLanguage.SWAHILI) {
                        "Tafadhali sema maandishi ya jibu unalotaka kutuma."
                    } else {
                        "Please tell me the exact reply text you want to send."
                    }
                    postAssistantReply(msg, badge = "NEEDS TEXT", lang = lang, speak = speakReply)
                    return
                }

                val handle = if (targetRaw.equals("last", ignoreCase = true)) {
                    NotificationReplyCache.latestReplyable
                } else {
                    NotificationReplyCache.findForSender(targetRaw)
                }

                if (handle == null) {
                    val msg = if (lang == AppLanguage.SWAHILI) {
                        "Hakuna kitufe cha kujibu haraka kutoka kwa $targetRaw. Fungua programu husika kujibu."
                    } else {
                        "No active quick-reply notification is available for $targetRaw. Open the app to reply."
                    }
                    postAssistantReply(msg, badge = "NO HANDLE", lang = lang, speak = speakReply)
                    return
                }

                val readBack = if (lang == AppLanguage.SWAHILI) {
                    "Tayari kutuma jibu kwa ${handle.sender} kwenye ${handle.appName}: \"$replyBody\". Sema Ndiyo au gusa Confirm kutuma."
                } else {
                    "Ready to reply to ${handle.sender} on ${handle.appName}: \"$replyBody\". Say Confirm or tap Confirm to send."
                }

                _pendingAction.value = PendingVoiceAction.SendReply(
                    sender = handle.sender,
                    appName = handle.appName,
                    replyText = replyBody,
                    targetLookupKey = targetRaw,
                    title = "SEND REPLY · ${handle.sender} (${handle.appName})",
                    readBackSummary = readBack
                )
                postAssistantReply(readBack, badge = "CONFIRM REPLY", lang = lang, speak = speakReply)
            }

            VoiceIntentType.CREATE_REMINDER -> {
                val title = response.reminderTitle?.trim().orEmpty().ifBlank { "Reminder" }
                val triggerAt = response.triggerAtMillis ?: (System.currentTimeMillis() + 3_600_000L)
                val fmt = SimpleDateFormat("EEE dd MMM, HH:mm", Locale.getDefault()).format(Date(triggerAt))
                val kind = if (response.isMeeting) "meeting" else "reminder"
                val readBack = if (lang == AppLanguage.SWAHILI) {
                    "Tayari kuhifadhi ${if (response.isMeeting) "mkutano" else "kikumbusho"}: \"$title\", saa $fmt. Sema Ndiyo au gusa Confirm kuhifadhi."
                } else {
                    "Ready to save $kind: \"$title\" for $fmt. Say Confirm or tap Confirm to save."
                }

                _pendingAction.value = PendingVoiceAction.CreateReminder(
                    reminderTitle = title,
                    triggerAtMillis = triggerAt,
                    isMeeting = response.isMeeting,
                    title = if (response.isMeeting) "CONFIRM MEETING" else "CONFIRM REMINDER",
                    readBackSummary = readBack
                )
                postAssistantReply(readBack, badge = "CONFIRM REMINDER", lang = lang, speak = speakReply)
            }

            VoiceIntentType.CALL_PERSON -> {
                val query = response.targetName?.trim().orEmpty()
                if (query.isEmpty()) {
                    val msg = if (lang == AppLanguage.SWAHILI) {
                        "Taja jina au namba ya mtu unayetaka kumpigia."
                    } else {
                        "Tell me the contact name or phone number you want to call."
                    }
                    postAssistantReply(msg, badge = "CALL", lang = lang, speak = speakReply)
                    return
                }

                val resolved = withContext(Dispatchers.IO) { resolveLocalPhoneTarget(query) }
                if (resolved == null) {
                    val msg = if (lang == AppLanguage.SWAHILI) {
                        "Sijaona namba ya $query kwenye majina yako."
                    } else {
                        "I could not find a phone number for $query in your contacts."
                    }
                    postAssistantReply(msg, badge = "NOT FOUND", lang = lang, speak = speakReply)
                    return
                }

                val (displayName, number) = resolved
                val readBack = if (lang == AppLanguage.SWAHILI) {
                    "Tayari kupiga simu kwa $displayName ($number). Sema Ndiyo au gusa Confirm kupiga."
                } else {
                    "Ready to call $displayName at $number. Say Confirm or tap Confirm to dial."
                }

                _pendingAction.value = PendingVoiceAction.PlaceCall(
                    displayName = displayName,
                    phoneNumber = number,
                    title = "CONFIRM CALL · $displayName",
                    readBackSummary = readBack
                )
                postAssistantReply(readBack, badge = "CONFIRM CALL", lang = lang, speak = speakReply)
            }

            VoiceIntentType.NONE -> {
                postAssistantReply(
                    text = response.spokenAnswer,
                    badge = if (response.usedCloudAi) "GEMINI" else "LOCAL",
                    lang = lang,
                    usedCloudAi = response.usedCloudAi,
                    speak = speakReply
                )
            }
        }
    }

    private fun postAssistantReply(
        text: String,
        badge: String?,
        lang: AppLanguage,
        usedCloudAi: Boolean = false,
        speak: Boolean
    ) {
        appendTurn(
            VoiceTurn(
                isOwner = false,
                text = text,
                badge = badge,
                usedCloudAi = usedCloudAi
            )
        )
        if (speak) {
            speechQueue.enqueue(text = text, language = lang, pauseDuringCall = false)
        }
    }

    private fun appendTurn(turn: VoiceTurn) {
        _turns.value = (_turns.value + turn).takeLast(40)
    }

    private fun formatNotificationForSpeech(
        item: NotificationLogEntity,
        full: Boolean,
        lang: AppLanguage
    ): String {
        if (item.isSensitiveShielded) {
            return if (lang == AppLanguage.SWAHILI) {
                "Ujumbe wa namba ya siri ulipokelewa kwenye ${item.appName} kutoka kwa ${item.sender}."
            } else {
                "Verification code received on ${item.appName} from ${item.sender}. Digits are hidden for safety."
            }
        }
        val body = if (full) item.fullText else item.previewText
        return if (lang == AppLanguage.SWAHILI) {
            "Ujumbe kutoka kwa ${item.sender} kwenye ${item.appName}: $body"
        } else {
            "Message from ${item.sender} on ${item.appName}: $body"
        }
    }

    private suspend fun buildLocalContext(): String {
        val timeFmt = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault())
        val recentMsgs = database.notificationLogDao().listRecent(12)
        val todayCalls = fetchTodayCalls()
        val reminders = database.reminderDao().listActive()
        val replyTarget = NotificationReplyCache.latestReplyable

        return buildString {
            appendLine("Recent notifications (newest first):")
            if (recentMsgs.isEmpty()) {
                appendLine("- None")
            } else {
                recentMsgs.forEach { n ->
                    val safeText = if (n.isSensitiveShielded) "[Verification code shielded]" else n.previewText
                    appendLine("- [${timeFmt.format(Date(n.receivedAt))}] ${n.sender} on ${n.appName}: $safeText")
                }
            }
            appendLine("Latest quick-replyable notification: ${replyTarget?.let { "${it.sender} on ${it.appName}" } ?: "None"}")
            appendLine("Today's device calls:")
            if (todayCalls.isEmpty()) {
                appendLine("- None recorded today")
            } else {
                todayCalls.take(10).forEach { c ->
                    val who = c.contactName ?: c.rawNumber
                    val tag = c.tagLabel?.let { " [$it]" }.orEmpty()
                    appendLine("- ${c.formattedTime}: $who$tag (${c.callTypeLabel})")
                }
            }
            appendLine("Active reminders & meetings:")
            if (reminders.isEmpty()) {
                appendLine("- None")
            } else {
                reminders.take(10).forEach { r ->
                    appendLine("- ${r.title} at ${timeFmt.format(Date(r.triggerAtMillis))}")
                }
            }
        }
    }

    private suspend fun fetchTodayCalls(): List<com.machine.voice.calls.DeviceCallLogEntry> {
        val tags = database.callerTagDao()
        val startOfDay = LocalDate.now()
            .atStartOfDay(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()
        return LocalCallerIdResolver.fetchRecentCallLog(
            context = appContext,
            callerTagDao = tags,
            tagsByNormalized = emptyMap(),
            limit = 40
        ).filter { it.timestamp >= startOfDay }
    }

    private fun resolveLocalPhoneTarget(query: String): Pair<String, String>? {
        val digits = query.filter { it.isDigit() || it == '+' }
        if (digits.count { it.isDigit() } >= 6) {
            return query to digits
        }
        if (ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_CONTACTS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return null
        }
        return try {
            appContext.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                ),
                "LOWER(${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME}) LIKE ?",
                arrayOf("%${query.lowercase()}%"),
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val name = cursor.getString(0)?.trim().orEmpty().ifEmpty { query }
                    val num = cursor.getString(1)?.trim().orEmpty()
                    if (num.isNotBlank()) name to num else null
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun isConfirmationPhrase(lower: String): Boolean {
        val cleaned = lower.trim().trimEnd('.', '!', '?')
        return cleaned in setOf(
            "confirm", "yes", "yes confirm", "send", "send it", "do it",
            "ok", "okay", "proceed", "go ahead",
            "ndiyo", "ndio", "sawa", "tuma", "kubali", "piga"
        )
    }

    private fun isCancellationPhrase(lower: String): Boolean {
        val cleaned = lower.trim().trimEnd('.', '!', '?')
        return cleaned in setOf(
            "cancel", "no", "never mind", "nevermind", "abort", "dont", "don't",
            "hapana", "ghairi", "sitisha", "acha"
        )
    }

    companion object {
        @Volatile
        private var INSTANCE: VoiceAssistantCoordinator? = null

        fun getInstance(context: Context): VoiceAssistantCoordinator {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: VoiceAssistantCoordinator(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
}
