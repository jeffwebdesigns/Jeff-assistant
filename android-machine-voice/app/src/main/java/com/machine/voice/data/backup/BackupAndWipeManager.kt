package com.machine.voice.data.backup

import android.content.Context
import com.machine.voice.ai.VoiceAssistantCoordinator
import com.machine.voice.briefing.BriefingScheduler
import com.machine.voice.data.local.AppRuleEntity
import com.machine.voice.data.local.CallerTagEntity
import com.machine.voice.data.local.ContactRuleEntity
import com.machine.voice.data.local.MachineDatabase
import com.machine.voice.data.local.ReminderEntity
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.RetentionWindow
import com.machine.voice.data.prefs.SecurePrefs
import com.machine.voice.data.prefs.VoiceInputLocale
import com.machine.voice.reminders.ReminderScheduler
import com.machine.voice.service.MachineKeepAliveService
import com.machine.voice.service.NotificationReplyCache
import com.machine.voice.service.VoiceOverlayService
import com.machine.voice.speech.SpeechQueueManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class BackupImportResult(
    val appRulesImported: Int,
    val contactRulesImported: Int,
    val callerTagsImported: Int,
    val remindersImported: Int
)

object BackupAndWipeManager {

    private const val SCHEMA_ID = "machine_voice_backup_v1"

    suspend fun exportBackupJson(context: Context): String = withContext(Dispatchers.IO) {
        val appContext = context.applicationContext
        val prefs = SecurePrefs(appContext)
        val settings = prefs.settings.value
        val db = MachineDatabase.getInstance(appContext)

        val appRules = db.appRuleDao().listAll()
        val contactRules = db.contactRuleDao().listAll()
        val callerTags = db.callerTagDao().listAll()
        val reminders = db.reminderDao().listAll()
        val notifications = db.notificationLogDao().listRecent(200)

        val root = JSONObject().apply {
            put("schema", SCHEMA_ID)
            put("exportedAt", System.currentTimeMillis())

            // Gemini API key is NEVER exported in plaintext backups.
            put(
                "settings",
                JSONObject().apply {
                    put("language", settings.language.code)
                    put("voiceInputLocale", settings.voiceInputLocale.tag)
                    put("aiEnabled", settings.aiEnabled)
                    put("keepAliveEnabled", settings.keepAliveEnabled)
                    put("notificationReaderEnabled", settings.notificationReaderEnabled)
                    put("headphoneOnlyMode", settings.headphoneOnlyMode)
                    put("ignoreGroups", settings.ignoreGroups)
                    put("ignoreMuted", settings.ignoreMuted)
                    put("quietHoursEnabled", settings.quietHoursEnabled)
                    put("quietHoursStart", settings.quietHoursStart)
                    put("quietHoursEnd", settings.quietHoursEnd)
                    put("vipBypassQuietHours", settings.vipBypassQuietHours)
                    put("voiceRate", settings.voiceRate.toDouble())
                    put("voicePitch", settings.voicePitch.toDouble())
                    put("callAnnouncerEnabled", settings.callAnnouncerEnabled)
                    put("callerOverlayEnabled", settings.callerOverlayEnabled)
                    put("silenceMarkedSpamCalls", settings.silenceMarkedSpamCalls)
                    put("rejectMarkedSpamCalls", settings.rejectMarkedSpamCalls)
                    put("floatingMicEnabled", settings.floatingMicEnabled)
                    put("wakeWordEnabled", settings.wakeWordEnabled)
                    put("morningBriefingEnabled", settings.morningBriefingEnabled)
                    put("morningBriefingTime", settings.morningBriefingTime)
                    put("speakBriefingOnUnlock", settings.speakBriefingOnUnlock)
                    put("retentionHours", settings.retentionWindow.hours)
                }
            )

            put(
                "appRules",
                JSONArray().apply {
                    appRules.forEach { r ->
                        put(
                            JSONObject().apply {
                                put("packageName", r.packageName)
                                put("appLabel", r.appLabel)
                                put("category", r.category)
                                put("enabled", r.enabled)
                            }
                        )
                    }
                }
            )

            put(
                "contactRules",
                JSONArray().apply {
                    contactRules.forEach { c ->
                        put(
                            JSONObject().apply {
                                put("senderKey", c.senderKey)
                                put("displayName", c.displayName)
                                put("priority", c.priority)
                            }
                        )
                    }
                }
            )

            put(
                "callerTags",
                JSONArray().apply {
                    callerTags.forEach { t ->
                        put(
                            JSONObject().apply {
                                put("normalizedNumber", t.normalizedNumber)
                                put("displayNumber", t.displayNumber)
                                put("tagLabel", t.tagLabel)
                                put("isSpam", t.isSpam)
                                put("updatedAt", t.updatedAt)
                            }
                        )
                    }
                }
            )

            put(
                "reminders",
                JSONArray().apply {
                    reminders.forEach { rem ->
                        put(
                            JSONObject().apply {
                                put("title", rem.title)
                                put("triggerAtMillis", rem.triggerAtMillis)
                                put("isMeeting", rem.isMeeting)
                                put("completed", rem.completed)
                                put("notes", rem.notes)
                                put("createdAt", rem.createdAt)
                            }
                        )
                    }
                }
            )

            put(
                "notificationLogs",
                JSONArray().apply {
                    notifications.forEach { n ->
                        put(
                            JSONObject().apply {
                                put("appName", n.appName)
                                put("sender", n.sender)
                                put("previewText", if (n.isSensitiveShielded) "[Verification code shielded]" else n.previewText)
                                put("languageCode", n.languageCode)
                                put("isVip", n.isVip)
                                put("receivedAt", n.receivedAt)
                            }
                        )
                    }
                }
            )
        }
        root.toString(2)
    }

    suspend fun importBackupJson(
        context: Context,
        rawJson: String
    ): BackupImportResult = withContext(Dispatchers.IO) {
        val appContext = context.applicationContext
        val root = JSONObject(rawJson)
        val schema = root.optString("schema", "")
        if (schema != SCHEMA_ID) {
            throw IllegalArgumentException("Unrecognized backup format. Expected $SCHEMA_ID.")
        }

        val prefs = SecurePrefs(appContext)
        val db = MachineDatabase.getInstance(appContext)

        root.optJSONObject("settings")?.let { s ->
            AppLanguage.entries.firstOrNull { it.code == s.optString("language") }
                ?.let { prefs.setLanguage(it) }
            VoiceInputLocale.entries.firstOrNull { it.tag == s.optString("voiceInputLocale") }
                ?.let { prefs.setVoiceInputLocale(it) }
            if (s.has("aiEnabled")) prefs.setAiEnabled(s.optBoolean("aiEnabled"))
            if (s.has("keepAliveEnabled")) prefs.setKeepAliveEnabled(s.optBoolean("keepAliveEnabled"))
            if (s.has("notificationReaderEnabled")) {
                prefs.setNotificationReaderEnabled(s.optBoolean("notificationReaderEnabled"))
            }
            if (s.has("headphoneOnlyMode")) prefs.setHeadphoneOnlyMode(s.optBoolean("headphoneOnlyMode"))
            if (s.has("ignoreGroups")) prefs.setIgnoreGroups(s.optBoolean("ignoreGroups"))
            if (s.has("ignoreMuted")) prefs.setIgnoreMuted(s.optBoolean("ignoreMuted"))
            if (s.has("quietHoursEnabled")) {
                prefs.setQuietHours(
                    enabled = s.optBoolean("quietHoursEnabled"),
                    start = s.optString("quietHoursStart", "22:00"),
                    end = s.optString("quietHoursEnd", "07:00")
                )
            }
            if (s.has("vipBypassQuietHours")) {
                prefs.setVipBypassQuietHours(s.optBoolean("vipBypassQuietHours"))
            }
            if (s.has("voiceRate") || s.has("voicePitch")) {
                prefs.setVoiceTuning(
                    rate = s.optDouble("voiceRate", 1.0).toFloat(),
                    pitch = s.optDouble("voicePitch", 1.0).toFloat()
                )
            }
            if (s.has("callAnnouncerEnabled")) {
                prefs.setCallAnnouncerEnabled(s.optBoolean("callAnnouncerEnabled"))
            }
            if (s.has("callerOverlayEnabled")) {
                prefs.setCallerOverlayEnabled(s.optBoolean("callerOverlayEnabled"))
            }
            if (s.has("silenceMarkedSpamCalls")) {
                prefs.setSilenceMarkedSpamCalls(s.optBoolean("silenceMarkedSpamCalls"))
            }
            if (s.has("rejectMarkedSpamCalls")) {
                prefs.setRejectMarkedSpamCalls(s.optBoolean("rejectMarkedSpamCalls"))
            }
            if (s.has("floatingMicEnabled")) {
                prefs.setFloatingMicEnabled(s.optBoolean("floatingMicEnabled"))
            }
            if (s.has("wakeWordEnabled")) {
                prefs.setWakeWordEnabled(s.optBoolean("wakeWordEnabled"))
            }
            if (s.has("morningBriefingEnabled")) {
                prefs.setMorningBriefingEnabled(s.optBoolean("morningBriefingEnabled"))
            }
            if (s.has("morningBriefingTime")) {
                prefs.setMorningBriefingTime(s.optString("morningBriefingTime", "07:30"))
            }
            if (s.has("speakBriefingOnUnlock")) {
                prefs.setSpeakBriefingOnUnlock(s.optBoolean("speakBriefingOnUnlock"))
            }
            RetentionWindow.entries.firstOrNull { it.hours == s.optInt("retentionHours", -1) }
                ?.let { prefs.setRetentionWindow(it) }
        }

        var appCount = 0
        root.optJSONArray("appRules")?.let { arr ->
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val pkg = obj.optString("packageName").trim()
                if (pkg.isEmpty()) continue
                db.appRuleDao().upsert(
                    AppRuleEntity(
                        packageName = pkg,
                        appLabel = obj.optString("appLabel", pkg),
                        category = obj.optString("category", "Other"),
                        enabled = obj.optBoolean("enabled", false)
                    )
                )
                appCount += 1
            }
        }

        var contactCount = 0
        root.optJSONArray("contactRules")?.let { arr ->
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val key = obj.optString("senderKey").trim().lowercase()
                if (key.isEmpty()) continue
                db.contactRuleDao().upsert(
                    ContactRuleEntity(
                        senderKey = key,
                        displayName = obj.optString("displayName", key),
                        priority = obj.optString("priority", "NORMAL")
                    )
                )
                contactCount += 1
            }
        }

        var tagCount = 0
        root.optJSONArray("callerTags")?.let { arr ->
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val norm = obj.optString("normalizedNumber").trim()
                if (norm.isEmpty()) continue
                db.callerTagDao().upsert(
                    CallerTagEntity(
                        normalizedNumber = norm,
                        displayNumber = obj.optString("displayNumber", norm),
                        tagLabel = obj.optString("tagLabel", ""),
                        isSpam = obj.optBoolean("isSpam", false),
                        updatedAt = obj.optLong("updatedAt", System.currentTimeMillis())
                    )
                )
                tagCount += 1
            }
        }

        var reminderCount = 0
        root.optJSONArray("reminders")?.let { arr ->
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val title = obj.optString("title").trim()
                if (title.isEmpty()) continue
                val entity = ReminderEntity(
                    title = title,
                    triggerAtMillis = obj.optLong("triggerAtMillis", System.currentTimeMillis()),
                    isMeeting = obj.optBoolean("isMeeting", false),
                    completed = obj.optBoolean("completed", false),
                    notes = obj.optString("notes", ""),
                    createdAt = obj.optLong("createdAt", System.currentTimeMillis())
                )
                val insertedId = db.reminderDao().upsert(entity)
                if (!entity.completed) {
                    ReminderScheduler.scheduleReminder(appContext, entity.copy(id = insertedId))
                }
                reminderCount += 1
            }
        }

        BriefingScheduler.scheduleNextDailyBriefing(appContext)
        VoiceOverlayService.syncVoiceControls(appContext, prefs.settings.value)

        BackupImportResult(
            appRulesImported = appCount,
            contactRulesImported = contactCount,
            callerTagsImported = tagCount,
            remindersImported = reminderCount
        )
    }

    suspend fun enforceRetentionNow(context: Context) = withContext(Dispatchers.IO) {
        val appContext = context.applicationContext
        val settings = SecurePrefs(appContext).settings.value
        val cutoff = System.currentTimeMillis() - (settings.retentionWindow.hours * 3_600_000L)
        MachineDatabase.getInstance(appContext).notificationLogDao().deleteOlderThan(cutoff)
    }

    suspend fun wipeAllLocalData(context: Context) = withContext(Dispatchers.IO) {
        val appContext = context.applicationContext
        val db = MachineDatabase.getInstance(appContext)

        db.reminderDao().listAll().forEach { ReminderScheduler.cancelReminder(appContext, it.id) }
        BriefingScheduler.cancelDailyBriefing(appContext)

        SpeechQueueManager.getInstance(appContext).stopAll()
        NotificationReplyCache.clear()
        VoiceAssistantCoordinator.getInstance(appContext).clearTranscript()

        db.notificationLogDao().deleteAll()
        db.appRuleDao().deleteAll()
        db.contactRuleDao().deleteAll()
        db.callerTagDao().deleteAll()
        db.reminderDao().deleteAll()
        db.ensureDefaultAppRulesSeeded()

        val prefs = SecurePrefs(appContext)
        prefs.clearAll()

        VoiceOverlayService.dismissIncomingCallCard(appContext)
        VoiceOverlayService.syncVoiceControls(appContext, prefs.settings.value)
        MachineKeepAliveService.stop(appContext)
    }
}
