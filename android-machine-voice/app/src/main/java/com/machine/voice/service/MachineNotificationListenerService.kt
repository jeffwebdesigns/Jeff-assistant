package com.machine.voice.service

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.machine.voice.data.local.AppRuleEntity
import com.machine.voice.data.local.ContactPriority
import com.machine.voice.data.local.MachineDatabase
import com.machine.voice.data.local.NotificationLogEntity
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.OwnerSettings
import com.machine.voice.data.prefs.SecurePrefs
import com.machine.voice.notifications.LanguageDetector
import com.machine.voice.notifications.SensitiveContentShield
import com.machine.voice.speech.SpeechQueueManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.LocalTime
import java.util.concurrent.ConcurrentHashMap

data class QuickReplyHandle(
    val sender: String,
    val appName: String,
    val replyIntent: PendingIntent,
    val remoteInput: RemoteInput,
    val timestamp: Long
)

object NotificationReplyCache {
    private val bySender = ConcurrentHashMap<String, QuickReplyHandle>()
    @Volatile
    var latestReplyable: QuickReplyHandle? = null
        private set

    fun put(handle: QuickReplyHandle) {
        bySender[handle.sender.lowercase()] = handle
        latestReplyable = handle
    }

    fun findForSender(name: String): QuickReplyHandle? {
        val key = name.trim().lowercase()
        return bySender.entries.firstOrNull { it.key.contains(key) || key.contains(it.key) }?.value
    }

    fun clear() {
        bySender.clear()
        latestReplyable = null
    }
}

class MachineNotificationListenerService : NotificationListenerService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val recentFingerprints = ConcurrentHashMap<String, Long>()

    private lateinit var database: MachineDatabase
    private lateinit var securePrefs: SecurePrefs
    private lateinit var speechQueue: SpeechQueueManager

    override fun onCreate() {
        super.onCreate()
        database = MachineDatabase.getInstance(applicationContext)
        securePrefs = SecurePrefs(applicationContext)
        speechQueue = SpeechQueueManager.getInstance(applicationContext)
        serviceScope.launch {
            database.ensureDefaultAppRulesSeeded()
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        serviceScope.launch {
            database.ensureDefaultAppRulesSeeded()
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val statusBarNotification = sbn ?: return
        val pkg = statusBarNotification.packageName ?: return
        if (pkg == packageName || pkg == "android" || pkg == "com.android.systemui") return

        val notification = statusBarNotification.notification ?: return
        if ((notification.flags and Notification.FLAG_ONGOING_EVENT) != 0) return
        if ((notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

        val settings = securePrefs.settings.value
        if (!settings.notificationReaderEnabled) return

        // Skip silent/low-priority channels when "ignore muted" is active
        if (settings.ignoreMuted) {
            val rankOut = Ranking()
            if (currentRanking?.getRanking(statusBarNotification.key, rankOut) == true) {
                if (rankOut.importance <= android.app.NotificationManager.IMPORTANCE_LOW) {
                    return
                }
            }
        }

        val extras = notification.extras ?: return
        val titleRaw = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val conversationTitle = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()?.trim().orEmpty()
        val isGroup = extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false) ||
            (conversationTitle.isNotEmpty() && conversationTitle != titleRaw)

        if (settings.ignoreGroups && isGroup) return

        val bodyText = extractNotificationText(extras)
        if (bodyText.isBlank()) return

        val sender = when {
            titleRaw.isNotBlank() -> titleRaw
            conversationTitle.isNotBlank() -> conversationTitle
            else -> resolveAppLabel(pkg)
        }

        // Deduplicate rapid double-posts from WhatsApp / Android OS within 2.5 seconds
        val now = System.currentTimeMillis()
        val fingerprint = "$pkg|$sender|$bodyText"
        val prevAt = recentFingerprints[fingerprint]
        if (prevAt != null && (now - prevAt) < 2500L) {
            return
        }
        recentFingerprints[fingerprint] = now
        if (recentFingerprints.size > 150) {
            recentFingerprints.entries.removeIf { (now - it.value) > 30_000L }
        }

        val appLabel = resolveAppLabel(pkg)
        extractQuickReplyAction(notification, sender, appLabel, now)

        serviceScope.launch {
            database.ensureDefaultAppRulesSeeded()

            // Enforce owner retention window automatically
            val cutoff = now - (settings.retentionWindow.hours * 3_600_000L)
            database.notificationLogDao().deleteOlderThan(cutoff)

            val existingAppRule = database.appRuleDao().findByPackage(pkg)
            if (existingAppRule == null) {
                database.appRuleDao().upsert(
                    AppRuleEntity(
                        packageName = pkg,
                        appLabel = appLabel,
                        category = "Other",
                        enabled = false
                    )
                )
                return@launch
            }
            if (!existingAppRule.enabled) return@launch

            val contactRule = database.contactRuleDao().findByKey(sender.lowercase())
            val priority = contactRule?.priority ?: ContactPriority.NORMAL.name
            val isVip = priority == ContactPriority.VIP.name
            val isSilent = priority == ContactPriority.SILENT.name

            val shieldResult = SensitiveContentShield.inspectAndRedact(bodyText)
            val detectedLang = LanguageDetector.detectLanguage(
                text = if (shieldResult.isSensitive) bodyText else "$sender $bodyText",
                fallback = settings.language
            )

            val shouldSpeak = shouldSpeakNotification(
                settings = settings,
                isVip = isVip,
                isSilent = isSilent
            )

            val spokenPhrase = if (shieldResult.isSensitive) {
                buildSensitiveSpeech(appLabel = appLabel, lang = detectedLang)
            } else {
                buildSpokenMessage(
                    sender = sender,
                    appName = appLabel,
                    text = shieldResult.redactedText,
                    lang = detectedLang
                )
            }

            val preview = if (shieldResult.isSensitive) {
                "Verification code received (digits shielded)"
            } else if (shieldResult.redactedText.length > 130) {
                shieldResult.redactedText.take(127).substringBeforeLast(' ', shieldResult.redactedText.take(127)) + "..."
            } else {
                shieldResult.redactedText
            }

            database.notificationLogDao().insert(
                NotificationLogEntity(
                    sbnKey = statusBarNotification.key ?: "$pkg:$now",
                    packageName = pkg,
                    appName = appLabel,
                    sender = sender,
                    previewText = preview,
                    fullText = shieldResult.redactedText,
                    languageCode = detectedLang.code,
                    isGroup = isGroup,
                    isSensitiveShielded = shieldResult.isSensitive,
                    isVip = isVip,
                    spokenAloud = shouldSpeak,
                    receivedAt = now
                )
            )

            if (shouldSpeak) {
                speechQueue.enqueue(
                    text = spokenPhrase,
                    language = detectedLang,
                    pauseDuringCall = true
                )
            }
        }
    }

    private fun shouldSpeakNotification(
        settings: OwnerSettings,
        isVip: Boolean,
        isSilent: Boolean
    ): Boolean {
        if (isSilent) return false
        if (settings.headphoneOnlyMode && !speechQueue.areHeadphonesOrBluetoothConnected()) {
            return false
        }
        if (settings.quietHoursEnabled && isWithinQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) {
            if (!(isVip && settings.vipBypassQuietHours)) {
                return false
            }
        }
        return true
    }

    private fun isWithinQuietHours(startStr: String, endStr: String): Boolean {
        return try {
            val start = LocalTime.parse(startStr)
            val end = LocalTime.parse(endStr)
            val now = LocalTime.now()
            if (start == end) {
                false
            } else if (start.isBefore(end)) {
                !now.isBefore(start) && now.isBefore(end)
            } else {
                // Crosses midnight, e.g. 22:00 -> 07:00
                !now.isBefore(start) || now.isBefore(end)
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun extractNotificationText(extras: android.os.Bundle): String {
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()
        if (!bigText.isNullOrBlank()) return bigText

        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
        if (!lines.isNullOrEmpty()) {
            val joined = lines.mapNotNull { it?.toString()?.trim() }.filter { it.isNotEmpty() }.joinToString(". ")
            if (joined.isNotBlank()) return joined
        }

        return extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()
    }

    private fun extractQuickReplyAction(
        notification: Notification,
        sender: String,
        appName: String,
        timestamp: Long
    ) {
        val actions = notification.actions ?: return
        for (action in actions) {
            val remoteInputs = action.remoteInputs ?: continue
            val textInput = remoteInputs.firstOrNull { it.allowFreeFormInput } ?: continue
            val pendingIntent = action.actionIntent ?: continue
            NotificationReplyCache.put(
                QuickReplyHandle(
                    sender = sender,
                    appName = appName,
                    replyIntent = pendingIntent,
                    remoteInput = textInput,
                    timestamp = timestamp
                )
            )
            break
        }
    }

    private fun resolveAppLabel(pkg: String): String {
        return try {
            val ai = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getApplicationInfo(pkg, 0)
            }
            packageManager.getApplicationLabel(ai).toString()
        } catch (_: Exception) {
            pkg.substringAfterLast('.')
        }
    }

    private fun buildSensitiveSpeech(appLabel: String, lang: AppLanguage): String {
        return if (lang == AppLanguage.SWAHILI) {
            "Ujumbe wa namba ya siri umepokelewa kwenye $appLabel."
        } else {
            "Verification code received on $appLabel."
        }
    }

    private fun buildSpokenMessage(
        sender: String,
        appName: String,
        text: String,
        lang: AppLanguage
    ): String {
        val normalized = text.replace(Regex("\\s+"), " ").trim()
        val isLong = normalized.length > 140
        val spokenBody = if (isLong) {
            val cut = normalized.take(120)
            cut.substringBeforeLast(' ', cut)
        } else {
            normalized
        }

        return if (lang == AppLanguage.SWAHILI) {
            if (isLong) {
                "Ujumbe kutoka kwa $sender kwenye $appName: $spokenBody. Sema soma yote au gusa Soma."
            } else {
                "Ujumbe kutoka kwa $sender kwenye $appName: $spokenBody"
            }
        } else {
            if (isLong) {
                "Message from $sender on $appName: $spokenBody. Say read full or tap Read."
            } else {
                "Message from $sender on $appName: $spokenBody"
            }
        }
    }

    override fun onDestroy() {
        serviceScope.cancel()
        super.onDestroy()
    }
}
