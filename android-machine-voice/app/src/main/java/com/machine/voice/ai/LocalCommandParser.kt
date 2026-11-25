package com.machine.voice.ai

import com.machine.voice.data.prefs.AppLanguage
import java.time.DayOfWeek
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

class LocalCommandParser : VoiceAiProvider {

    override suspend fun interpretAndAnswer(
        prompt: String,
        localContext: String,
        preferredLang: AppLanguage
    ): VoiceAiResponse {
        val raw = prompt.trim()
        val lower = raw.lowercase()

        if (lower in listOf("stop", "quiet", "silence", "simama", "nyamaza", "acha")) {
            return VoiceAiResponse(
                intentType = VoiceIntentType.STOP_SPEAKING,
                spokenAnswer = if (preferredLang == AppLanguage.SWAHILI) "Nimeacha." else "Stopped."
            )
        }

        if (lower.contains("read full") || lower.contains("soma yote")) {
            return VoiceAiResponse(
                intentType = VoiceIntentType.READ_FULL_LAST,
                spokenAnswer = ""
            )
        }

        if (lower.contains("briefing") || lower.contains("muhtasari")) {
            return VoiceAiResponse(
                intentType = VoiceIntentType.OPEN_BRIEFING,
                spokenAnswer = ""
            )
        }

        if (lower.contains("who called") || lower.contains("called today") || lower.contains("nani alipiga")) {
            return VoiceAiResponse(
                intentType = VoiceIntentType.WHO_CALLED_TODAY,
                spokenAnswer = ""
            )
        }

        val senderMatch = Regex("what did (.+?) say\\??", RegexOption.IGNORE_CASE).find(raw)
            ?: Regex("ujumbe wa (.+)", RegexOption.IGNORE_CASE).find(raw)
        if (senderMatch != null) {
            val target = senderMatch.groupValues[1].trim()
            return VoiceAiResponse(
                intentType = VoiceIntentType.READ_SENDER,
                targetName = target,
                spokenAnswer = ""
            )
        }

        if (lower.contains("read my messages") || lower.contains("read messages") || lower.contains("soma ujumbe")) {
            return VoiceAiResponse(
                intentType = VoiceIntentType.READ_MESSAGES,
                spokenAnswer = ""
            )
        }

        val replyWithMatch = Regex(
            "(?:reply to|respond to|jibu)\\s+(.+?)\\s+(?:with|:|saying)\\s*[:\\-]?\\s*(.+)",
            RegexOption.IGNORE_CASE
        ).find(raw)
        if (replyWithMatch != null) {
            val targetRaw = replyWithMatch.groupValues[1].trim()
            val message = replyWithMatch.groupValues[2].trim()
            val cleanTarget = if (targetRaw.contains("last", ignoreCase = true) || targetRaw.contains("mwisho", ignoreCase = true)) {
                "last"
            } else {
                targetRaw
            }
            return VoiceAiResponse(
                intentType = VoiceIntentType.REPLY_MESSAGE,
                targetName = cleanTarget,
                replyText = message,
                spokenAnswer = "Prepared reply: $message"
            )
        }

        if (lower.startsWith("remind") ||
            lower.contains("set a reminder") ||
            lower.contains("schedule a meeting") ||
            lower.startsWith("schedule ") ||
            lower.contains("nikumbushe")
        ) {
            val isMeeting = lower.contains("meeting") || lower.contains("mkutano") || lower.contains("appointment")
            val triggerMillis = parseApproximateDateTimeMillis(raw)
            val title = raw
                .replace(Regex("^(set a reminder( for)?|remind me( to)?|schedule a meeting( for)?|schedule|nikumbushe)\\s*", RegexOption.IGNORE_CASE), "")
                .trim()
                .ifEmpty { if (isMeeting) "Scheduled Meeting" else "Reminder" }

            return VoiceAiResponse(
                intentType = VoiceIntentType.CREATE_REMINDER,
                reminderTitle = title,
                triggerAtMillis = triggerMillis,
                isMeeting = isMeeting,
                spokenAnswer = "Reminder parsed locally."
            )
        }

        val callMatch = Regex("^(?:call|phone|piga simu)\\s+(.+)", RegexOption.IGNORE_CASE).find(raw)
        if (callMatch != null) {
            return VoiceAiResponse(
                intentType = VoiceIntentType.CALL_PERSON,
                targetName = callMatch.groupValues[1].trim(),
                spokenAnswer = "Preparing call."
            )
        }

        return VoiceAiResponse(
            intentType = VoiceIntentType.NONE,
            spokenAnswer = if (preferredLang == AppLanguage.SWAHILI) {
                "Hali iko nje ya mtandao kwa AI. Unaweza kuuliza amri za ndani kama 'read my messages', 'who called today', au washa Gemini na uweke ufunguo wako kwenye Mipangilio kwa maswali yote."
            } else {
                "On-device mode active. Say commands like 'read my messages', 'what did Amina say', 'who called today', or 'set a reminder for 3pm'. Enable Gemini with your API key in Settings to answer general questions."
            }
        )
    }

    private fun parseApproximateDateTimeMillis(text: String): Long {
        val now = LocalDateTime.now()
        var targetDate = now.toLocalDate()
        val lower = text.lowercase()

        if (lower.contains("tomorrow") || lower.contains("kesho")) {
            targetDate = targetDate.plusDays(1)
        } else {
            val days = mapOf(
                "monday" to DayOfWeek.MONDAY,
                "tuesday" to DayOfWeek.TUESDAY,
                "wednesday" to DayOfWeek.WEDNESDAY,
                "thursday" to DayOfWeek.THURSDAY,
                "friday" to DayOfWeek.FRIDAY,
                "saturday" to DayOfWeek.SATURDAY,
                "sunday" to DayOfWeek.SUNDAY
            )
            days.entries.firstOrNull { lower.contains(it.key) }?.let { (_, dow) ->
                targetDate = targetDate.with(TemporalAdjusters.nextOrSame(dow))
            }
        }

        val timeMatch = Regex("\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\b", RegexOption.IGNORE_CASE).find(lower)
        val time = if (timeMatch != null) {
            var hour = timeMatch.groupValues[1].toIntOrNull()?.coerceIn(0, 23) ?: 9
            val min = timeMatch.groupValues[2].toIntOrNull()?.coerceIn(0, 59) ?: 0
            val amPm = timeMatch.groupValues[3].lowercase()
            if (amPm == "pm" && hour in 1..11) hour += 12
            if (amPm == "am" && hour == 12) hour = 0
            LocalTime.of(hour, min)
        } else {
            now.toLocalTime().plusHours(1).withMinute(0).withSecond(0)
        }

        var candidate = LocalDateTime.of(targetDate, time)
        if (!candidate.isAfter(now)) {
            candidate = candidate.plusDays(1)
        }
        return candidate.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
    }
}
