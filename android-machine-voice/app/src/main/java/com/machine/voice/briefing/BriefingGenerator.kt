package com.machine.voice.briefing

import android.content.Context
import com.machine.voice.ai.GeminiRestVoiceProvider
import com.machine.voice.calls.DeviceCallLogEntry
import com.machine.voice.calls.LocalCallerIdResolver
import com.machine.voice.data.local.MachineDatabase
import com.machine.voice.data.local.NotificationLogEntity
import com.machine.voice.data.local.ReminderEntity
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.SecurePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

data class BriefingReport(
    val generatedAt: Long,
    val headline: String,
    val spokenScript: String,
    val overdueReminders: List<ReminderEntity>,
    val todayReminders: List<ReminderEntity>,
    val missedCalls: List<DeviceCallLogEntry>,
    val vipMessages: List<NotificationLogEntity>,
    val recentMessageCount: Int,
    val usedCloudAi: Boolean
) {
    val urgentItemCount: Int
        get() = overdueReminders.size + missedCalls.size + vipMessages.size
}

object BriefingGenerator {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    suspend fun generate(
        context: Context,
        allowCloudPolish: Boolean = true
    ): BriefingReport = withContext(Dispatchers.IO) {
        val appContext = context.applicationContext
        val securePrefs = SecurePrefs(appContext)
        val settings = securePrefs.settings.value
        val lang = settings.language
        val db = MachineDatabase.getInstance(appContext)

        val now = System.currentTimeMillis()
        val last24h = now - 86_400_000L
        val endOfToday = LocalDate.now()
            .plusDays(1)
            .atStartOfDay(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()

        val activeReminders = db.reminderDao().listActive()
        val overdueReminders = activeReminders.filter { it.triggerAtMillis <= now }
        val todayReminders = activeReminders.filter {
            it.triggerAtMillis > now && it.triggerAtMillis < endOfToday
        }

        val recentMessages = db.notificationLogDao().listRecent(30)
            .filter { it.receivedAt >= last24h }
        val vipMessages = recentMessages.filter { it.isVip }

        val missedCalls = LocalCallerIdResolver.fetchRecentCallLog(
            context = appContext,
            callerTagDao = db.callerTagDao(),
            tagsByNormalized = emptyMap(),
            limit = 40
        ).filter {
            it.timestamp >= last24h && it.callTypeLabel.equals("Missed", ignoreCase = true)
        }

        val greeting = buildGreeting(lang)
        val headline = buildHeadline(
            lang = lang,
            missedCount = missedCalls.size,
            overdueCount = overdueReminders.size,
            todayCount = todayReminders.size,
            vipCount = vipMessages.size
        )

        val localScript = buildLocalScript(
            greeting = greeting,
            lang = lang,
            overdue = overdueReminders,
            today = todayReminders,
            missed = missedCalls,
            vipMessages = vipMessages,
            totalRecentMessages = recentMessages.size
        )

        val apiKey = securePrefs.getGeminiApiKey()
        val polishedScript = if (allowCloudPolish && settings.aiEnabled && !apiKey.isNullOrBlank()) {
            polishWithGemini(
                apiKey = apiKey,
                lang = lang,
                rawFacts = buildFactsBlock(
                    overdue = overdueReminders,
                    today = todayReminders,
                    missed = missedCalls,
                    vipMessages = vipMessages,
                    totalRecentMessages = recentMessages.size
                )
            )
        } else {
            null
        }

        BriefingReport(
            generatedAt = now,
            headline = headline,
            spokenScript = polishedScript ?: localScript,
            overdueReminders = overdueReminders,
            todayReminders = todayReminders,
            missedCalls = missedCalls,
            vipMessages = vipMessages,
            recentMessageCount = recentMessages.size,
            usedCloudAi = polishedScript != null
        )
    }

    private fun buildGreeting(lang: AppLanguage): String {
        val hour = LocalTime.now().hour
        return if (lang == AppLanguage.SWAHILI) {
            when {
                hour < 12 -> "Habari za asubuhi"
                hour < 17 -> "Habari za mchana"
                else -> "Habari za jioni"
            }
        } else {
            when {
                hour < 12 -> "Good morning"
                hour < 17 -> "Good afternoon"
                else -> "Good evening"
            }
        }
    }

    private fun buildHeadline(
        lang: AppLanguage,
        missedCount: Int,
        overdueCount: Int,
        todayCount: Int,
        vipCount: Int
    ): String {
        return if (lang == AppLanguage.SWAHILI) {
            "Simu zilizokosekana $missedCount · Zilizopita muda $overdueCount · Ratiba leo $todayCount · VIP $vipCount"
        } else {
            "$missedCount missed call${plural(missedCount)} · $overdueCount overdue · $todayCount due today · $vipCount VIP alert${plural(vipCount)}"
        }
    }

    private fun buildLocalScript(
        greeting: String,
        lang: AppLanguage,
        overdue: List<ReminderEntity>,
        today: List<ReminderEntity>,
        missed: List<DeviceCallLogEntry>,
        vipMessages: List<NotificationLogEntity>,
        totalRecentMessages: Int
    ): String {
        val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
        return if (lang == AppLanguage.SWAHILI) {
            buildString {
                append("$greeting. Huu ni muhtasari wako. ")
                if (overdue.isNotEmpty()) {
                    append("Una vikumbusho ${overdue.size} vilivyopita muda, kwanza: ${overdue.first().title}. ")
                }
                if (today.isNotEmpty()) {
                    val items = today.take(3).joinToString(", ") {
                        "${it.title} saa ${timeFmt.format(Date(it.triggerAtMillis))}"
                    }
                    append("Ratiba ya leo: $items. ")
                } else if (overdue.isEmpty()) {
                    append("Huna kikumbusho chochote kilichopangwa leo. ")
                }
                if (missed.isNotEmpty()) {
                    val callers = missed.take(3).joinToString(", ") {
                        it.contactName ?: it.tagLabel ?: it.rawNumber
                    }
                    append("Kuna simu ${missed.size} ambazo hukupokea kutoka kwa: $callers. ")
                }
                if (vipMessages.isNotEmpty()) {
                    val firstVip = vipMessages.first()
                    val preview = if (firstVip.isSensitiveShielded) "ujumbe wa namba ya siri" else firstVip.previewText
                    append("Ujumbe muhimu wa VIP kutoka kwa ${firstVip.sender}: $preview.")
                } else {
                    append("Jumla ya arifa za ujumbe katika saa 24 zilizopita ni $totalRecentMessages.")
                }
            }.trim()
        } else {
            buildString {
                append("$greeting. Here is your briefing. ")
                if (overdue.isNotEmpty()) {
                    append("You have ${overdue.size} overdue reminder${plural(overdue.size)}, starting with ${overdue.first().title}. ")
                }
                if (today.isNotEmpty()) {
                    val items = today.take(3).joinToString(", ") {
                        "${it.title} at ${timeFmt.format(Date(it.triggerAtMillis))}"
                    }
                    append("Scheduled today: $items. ")
                } else if (overdue.isEmpty()) {
                    append("Your calendar schedule for today is clear. ")
                }
                if (missed.isNotEmpty()) {
                    val callers = missed.take(3).joinToString(", ") {
                        it.contactName ?: it.tagLabel ?: it.rawNumber
                    }
                    append("You missed ${missed.size} call${plural(missed.size)} in the last 24 hours from $callers. ")
                }
                if (vipMessages.isNotEmpty()) {
                    val firstVip = vipMessages.first()
                    val preview = if (firstVip.isSensitiveShielded) "a verification code" else firstVip.previewText
                    append("Priority VIP message from ${firstVip.sender} on ${firstVip.appName}: $preview.")
                } else {
                    append("You received $totalRecentMessages notification alert${plural(totalRecentMessages)} over the past 24 hours.")
                }
            }.trim()
        }
    }

    private fun buildFactsBlock(
        overdue: List<ReminderEntity>,
        today: List<ReminderEntity>,
        missed: List<DeviceCallLogEntry>,
        vipMessages: List<NotificationLogEntity>,
        totalRecentMessages: Int
    ): String {
        val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
        return buildString {
            appendLine("Overdue reminders (${overdue.size}): ${overdue.take(5).joinToString("; ") { it.title }.ifEmpty { "None" }}")
            appendLine("Today's schedule (${today.size}): ${today.take(5).joinToString("; ") { "${it.title} at ${timeFmt.format(Date(it.triggerAtMillis))}" }.ifEmpty { "None" }}")
            appendLine("Missed calls last 24h (${missed.size}): ${missed.take(5).joinToString("; ") { "${it.contactName ?: it.rawNumber}${it.tagLabel?.let { t -> " [$t]" } ?: ""} (${it.formattedTime})" }.ifEmpty { "None" }}")
            appendLine("VIP messages (${vipMessages.size}): ${vipMessages.take(5).joinToString("; ") { "${it.sender} on ${it.appName}: ${if (it.isSensitiveShielded) "[Verification code shielded]" else it.previewText}" }.ifEmpty { "None" }}")
            appendLine("Total recent notifications (24h): $totalRecentMessages")
        }
    }

    private fun polishWithGemini(
        apiKey: String,
        lang: AppLanguage,
        rawFacts: String
    ): String? {
        return try {
            val langLabel = if (lang == AppLanguage.SWAHILI) "Kiswahili" else "English"
            val sys = """
You are MACHINE VOICE delivering a calm, precise spoken briefing to one owner.
Summarize the exact facts provided below in 3 to 5 crisp, natural spoken sentences in $langLabel.
Do NOT use markdown, bullet points, asterisks, or emojis so TextToSpeech reads cleanly.
Use ONLY the facts given; never invent names, numbers, or events.
            """.trimIndent()

            val bodyJson = JSONObject().apply {
                put(
                    "systemInstruction",
                    JSONObject().put("parts", JSONArray().put(JSONObject().put("text", sys)))
                )
                put(
                    "contents",
                    JSONArray().put(
                        JSONObject()
                            .put("role", "user")
                            .put("parts", JSONArray().put(JSONObject().put("text", rawFacts)))
                    )
                )
            }

            val req = Request.Builder()
                .url("https://generativelanguage.googleapis.com/v1beta/models/${GeminiRestVoiceProvider.MODEL_ID}:generateContent")
                .addHeader("Content-Type", "application/json")
                .addHeader("x-goog-api-key", apiKey)
                .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
                .build()

            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val raw = resp.body?.string().orEmpty()
                val text = JSONObject(raw)
                    .optJSONArray("candidates")
                    ?.optJSONObject(0)
                    ?.optJSONObject("content")
                    ?.optJSONArray("parts")
                    ?.optJSONObject(0)
                    ?.optString("text")
                    ?.trim()
                text?.takeIf { it.isNotEmpty() }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun plural(count: Int): String = if (count == 1) "" else "s"
}
