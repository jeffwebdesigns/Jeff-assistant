package com.machine.voice.ai

import com.machine.voice.data.prefs.AppLanguage

enum class VoiceIntentType {
    NONE,
    READ_MESSAGES,
    READ_SENDER,
    READ_FULL_LAST,
    WHO_CALLED_TODAY,
    STOP_SPEAKING,
    REPLY_MESSAGE,
    CREATE_REMINDER,
    CALL_PERSON,
    OPEN_BRIEFING
}

data class VoiceAiResponse(
    val intentType: VoiceIntentType,
    val spokenAnswer: String,
    val targetName: String? = null,
    val replyText: String? = null,
    val reminderTitle: String? = null,
    val triggerAtMillis: Long? = null,
    val isMeeting: Boolean = false,
    val usedCloudAi: Boolean = false,
    val errorMessage: String? = null
)

interface VoiceAiProvider {
    suspend fun interpretAndAnswer(
        prompt: String,
        localContext: String,
        preferredLang: AppLanguage
    ): VoiceAiResponse
}
