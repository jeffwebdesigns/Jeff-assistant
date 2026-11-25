package com.machine.voice.ai

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
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

class GeminiRestVoiceProvider(
    private val securePrefs: SecurePrefs,
    private val localFallback: VoiceAiProvider
) : VoiceAiProvider {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    override suspend fun interpretAndAnswer(
        prompt: String,
        localContext: String,
        preferredLang: AppLanguage
    ): VoiceAiResponse {
        val settings = securePrefs.settings.value
        val apiKey = securePrefs.getGeminiApiKey()

        if (!settings.aiEnabled || apiKey.isNullOrBlank()) {
            return localFallback.interpretAndAnswer(prompt, localContext, preferredLang)
        }

        // Handle instant deterministic "stop" immediately without wasting network latency
        val lower = prompt.trim().lowercase()
        if (lower == "stop" || lower == "simama" || lower == "nyamaza") {
            return VoiceAiResponse(
                intentType = VoiceIntentType.STOP_SPEAKING,
                spokenAnswer = if (preferredLang == AppLanguage.SWAHILI) "Nimeacha." else "Stopped."
            )
        }

        return withContext(Dispatchers.IO) {
            try {
                val nowIso = ZonedDateTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                val systemPrompt = """
You are MACHINE VOICE, a calm, observant, articulate private assistant serving ONE owner.
You serve two roles seamlessly:
1) VOICE COMMAND ROUTER for device actions.
2) UNIVERSAL QUESTION ANSWERER capable of understanding and answering ANY legitimate question clearly (general knowledge, science, math, technology, advice, translations, history, Kenya/East Africa context, KES calculations, OR personal queries about the owner's local context below).

Understand imperfect speech-to-text transcripts, typos, English, Kiswahili, and Kenyan Swahili-English phrasing charitably. Reply in the same language the owner used (${preferredLang.label} default).
Speak cleanly and naturally without heavy markdown symbols so TextToSpeech reads smoothly.
For private personal questions (messages, calls, reminders), rely ONLY on [LOCAL CONTEXT]; if absent, say clearly what is missing without inventing data.

Classify intentType as ONE of:
- NONE: general question, conversation, explanation, calculation, translation, or personal Q&A answered directly in spokenAnswer.
- READ_MESSAGES: owner wants recent messages read aloud.
- READ_SENDER: owner asks what a specific person sent (set targetName).
- READ_FULL_LAST: owner says "read full" / "soma yote".
- WHO_CALLED_TODAY: owner asks who called today.
- STOP_SPEAKING: owner says stop / cancel audio.
- REPLY_MESSAGE: owner wants to send a reply (set targetName, empty or "last" for latest message, and replyText).
- CREATE_REMINDER: owner wants to set a reminder or meeting (set reminderTitle, triggerIso as full ISO-8601 datetime with timezone offset, and isMeeting boolean).
- CALL_PERSON: owner wants to phone someone (set targetName).
- OPEN_BRIEFING: owner asks for their daily briefing.

Current local device time: $nowIso
                """.trimIndent()

                val requestJson = JSONObject().apply {
                    put(
                        "systemInstruction",
                        JSONObject().put("parts", JSONArray().put(JSONObject().put("text", systemPrompt)))
                    )
                    put(
                        "contents",
                        JSONArray().put(
                            JSONObject()
                                .put("role", "user")
                                .put(
                                    "parts",
                                    JSONArray().put(
                                        JSONObject().put(
                                            "text",
                                            "[LOCAL CONTEXT]\n$localContext\n\n[OWNER SPOKEN/TYPED INPUT]\n$prompt"
                                        )
                                    )
                                )
                        )
                    )
                    put(
                        "generationConfig",
                        JSONObject()
                            .put("responseMimeType", "application/json")
                            .put(
                                "responseSchema",
                                JSONObject()
                                    .put("type", "OBJECT")
                                    .put(
                                        "properties",
                                        JSONObject()
                                            .put("intentType", JSONObject().put("type", "STRING"))
                                            .put("spokenAnswer", JSONObject().put("type", "STRING"))
                                            .put("targetName", JSONObject().put("type", "STRING"))
                                            .put("replyText", JSONObject().put("type", "STRING"))
                                            .put("reminderTitle", JSONObject().put("type", "STRING"))
                                            .put("triggerIso", JSONObject().put("type", "STRING"))
                                            .put("isMeeting", JSONObject().put("type", "BOOLEAN"))
                                    )
                                    .put("required", JSONArray().put("intentType").put("spokenAnswer"))
                            )
                    )
                }

                val url = "https://generativelanguage.googleapis.com/v1beta/models/$MODEL_ID:generateContent"
                val req = Request.Builder()
                    .url(url)
                    .addHeader("Content-Type", "application/json")
                    .addHeader("x-goog-api-key", apiKey)
                    .post(requestJson.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                client.newCall(req).execute().use { resp ->
                    val rawBody = resp.body?.string().orEmpty()
                    if (!resp.isSuccessful) {
                        val fallback = localFallback.interpretAndAnswer(prompt, localContext, preferredLang)
                        val errHint = when (resp.code) {
                            429 -> "Gemini rate limit reached. Try again shortly."
                            400, 401, 403 -> "Gemini API key was rejected. Check Settings."
                            else -> "Gemini HTTP ${resp.code}."
                        }
                        return@withContext if (fallback.intentType != VoiceIntentType.NONE) {
                            fallback
                        } else {
                            fallback.copy(
                                spokenAnswer = errHint,
                                errorMessage = errHint
                            )
                        }
                    }

                    val root = JSONObject(rawBody)
                    val candidateText = root.optJSONArray("candidates")
                        ?.optJSONObject(0)
                        ?.optJSONObject("content")
                        ?.optJSONArray("parts")
                        ?.optJSONObject(0)
                        ?.optString("text")
                        .orEmpty()

                    val parsed = JSONObject(candidateText)
                    val intentName = parsed.optString("intentType", "NONE")
                    val intentType = VoiceIntentType.entries.firstOrNull { it.name == intentName }
                        ?: VoiceIntentType.NONE

                    val triggerIso = parsed.optString("triggerIso", "").trim()
                    val triggerMillis = if (triggerIso.isNotEmpty()) {
                        try {
                            ZonedDateTime.parse(triggerIso).toInstant().toEpochMilli()
                        } catch (_: Exception) {
                            null
                        }
                    } else {
                        null
                    }

                    VoiceAiResponse(
                        intentType = intentType,
                        spokenAnswer = parsed.optString("spokenAnswer", "").ifBlank {
                            "Understood."
                        },
                        targetName = parsed.optString("targetName", "").takeIf { it.isNotBlank() },
                        replyText = parsed.optString("replyText", "").takeIf { it.isNotBlank() },
                        reminderTitle = parsed.optString("reminderTitle", "").takeIf { it.isNotBlank() },
                        triggerAtMillis = triggerMillis,
                        isMeeting = parsed.optBoolean("isMeeting", false),
                        usedCloudAi = true
                    )
                }
            } catch (e: Exception) {
                val fallback = localFallback.interpretAndAnswer(prompt, localContext, preferredLang)
                if (fallback.intentType != VoiceIntentType.NONE) {
                    fallback
                } else {
                    fallback.copy(
                        spokenAnswer = "Unable to reach Gemini right now. Local commands remain available.",
                        errorMessage = e.message ?: "Network error"
                    )
                }
            }
        }
    }

    companion object {
        const val MODEL_ID = "gemini-4-hydrogen"
    }
}
