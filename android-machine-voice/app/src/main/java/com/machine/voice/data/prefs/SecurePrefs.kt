package com.machine.voice.data.prefs

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class AppLanguage(val code: String, val label: String) {
    ENGLISH("en", "English"),
    SWAHILI("sw", "Kiswahili")
}

enum class VoiceInputLocale(val tag: String, val label: String) {
    EN_KE("en-KE", "EN-KE"),
    EN_US("en-US", "EN-US"),
    SW_KE("sw-KE", "SW-KE")
}

enum class RetentionWindow(val hours: Int, val labelEn: String, val labelSw: String) {
    ONE_HOUR(1, "1 Hour", "Saa 1"),
    TWENTY_FOUR_HOURS(24, "24 Hours", "Saa 24"),
    SEVEN_DAYS(168, "7 Days", "Siku 7")
}

data class OwnerSettings(
    val onboardingCompleted: Boolean = false,
    val language: AppLanguage = AppLanguage.ENGLISH,
    val voiceInputLocale: VoiceInputLocale = VoiceInputLocale.EN_KE,
    val aiEnabled: Boolean = false,
    val hasGeminiKey: Boolean = false,
    val keepAliveEnabled: Boolean = true,
    val notificationReaderEnabled: Boolean = true,
    val headphoneOnlyMode: Boolean = false,
    val ignoreGroups: Boolean = false,
    val ignoreMuted: Boolean = true,
    val quietHoursEnabled: Boolean = false,
    val quietHoursStart: String = "22:00",
    val quietHoursEnd: String = "07:00",
    val vipBypassQuietHours: Boolean = true,
    val voiceRate: Float = 1.0f,
    val voicePitch: Float = 1.0f,
    val callAnnouncerEnabled: Boolean = true,
    val callerOverlayEnabled: Boolean = true,
    val silenceMarkedSpamCalls: Boolean = true,
    val rejectMarkedSpamCalls: Boolean = false,
    val floatingMicEnabled: Boolean = false,
    val wakeWordEnabled: Boolean = false,
    val morningBriefingEnabled: Boolean = true,
    val morningBriefingTime: String = "07:30",
    val speakBriefingOnUnlock: Boolean = false,
    val lastBriefingSpokenDate: String = "",
    val retentionWindow: RetentionWindow = RetentionWindow.TWENTY_FOUR_HOURS
)

class SecurePrefs(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "machine_voice_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    private val _settings = MutableStateFlow(readSnapshot())
    val settings: StateFlow<OwnerSettings> = _settings.asStateFlow()

    private fun readSnapshot(): OwnerSettings {
        val langCode = prefs.getString(KEY_LANGUAGE, AppLanguage.ENGLISH.code)
        val inputTag = prefs.getString(KEY_VOICE_INPUT_LOCALE, VoiceInputLocale.EN_KE.tag)
        val retHours = prefs.getInt(KEY_RETENTION_HOURS, RetentionWindow.TWENTY_FOUR_HOURS.hours)
        return OwnerSettings(
            onboardingCompleted = prefs.getBoolean(KEY_ONBOARDING_DONE, false),
            language = AppLanguage.entries.firstOrNull { it.code == langCode } ?: AppLanguage.ENGLISH,
            voiceInputLocale = VoiceInputLocale.entries.firstOrNull { it.tag == inputTag } ?: VoiceInputLocale.EN_KE,
            aiEnabled = prefs.getBoolean(KEY_AI_ENABLED, false),
            hasGeminiKey = !prefs.getString(KEY_GEMINI_API_KEY, "").isNullOrBlank(),
            keepAliveEnabled = prefs.getBoolean(KEY_KEEP_ALIVE, true),
            notificationReaderEnabled = prefs.getBoolean(KEY_READER_ENABLED, true),
            headphoneOnlyMode = prefs.getBoolean(KEY_HEADPHONE_ONLY, false),
            ignoreGroups = prefs.getBoolean(KEY_IGNORE_GROUPS, false),
            ignoreMuted = prefs.getBoolean(KEY_IGNORE_MUTED, true),
            quietHoursEnabled = prefs.getBoolean(KEY_QUIET_HOURS, false),
            quietHoursStart = prefs.getString(KEY_QUIET_START, "22:00") ?: "22:00",
            quietHoursEnd = prefs.getString(KEY_QUIET_END, "07:00") ?: "07:00",
            vipBypassQuietHours = prefs.getBoolean(KEY_VIP_BYPASS_QUIET, true),
            voiceRate = prefs.getFloat(KEY_VOICE_RATE, 1.0f).coerceIn(0.6f, 1.6f),
            voicePitch = prefs.getFloat(KEY_VOICE_PITCH, 1.0f).coerceIn(0.6f, 1.5f),
            callAnnouncerEnabled = prefs.getBoolean(KEY_CALL_ANNOUNCER, true),
            callerOverlayEnabled = prefs.getBoolean(KEY_CALLER_OVERLAY, true),
            silenceMarkedSpamCalls = prefs.getBoolean(KEY_SILENCE_SPAM, true),
            rejectMarkedSpamCalls = prefs.getBoolean(KEY_REJECT_SPAM, false),
            floatingMicEnabled = prefs.getBoolean(KEY_FLOATING_MIC, false),
            wakeWordEnabled = prefs.getBoolean(KEY_WAKE_WORD, false),
            morningBriefingEnabled = prefs.getBoolean(KEY_MORNING_BRIEFING_ENABLED, true),
            morningBriefingTime = prefs.getString(KEY_MORNING_BRIEFING_TIME, "07:30") ?: "07:30",
            speakBriefingOnUnlock = prefs.getBoolean(KEY_SPEAK_BRIEFING_ON_UNLOCK, false),
            lastBriefingSpokenDate = prefs.getString(KEY_LAST_BRIEFING_DATE, "") ?: "",
            retentionWindow = RetentionWindow.entries.firstOrNull { it.hours == retHours }
                ?: RetentionWindow.TWENTY_FOUR_HOURS
        )
    }

    fun setOnboardingCompleted(completed: Boolean) {
        prefs.edit().putBoolean(KEY_ONBOARDING_DONE, completed).apply()
        _settings.value = readSnapshot()
    }

    fun setLanguage(language: AppLanguage) {
        prefs.edit().putString(KEY_LANGUAGE, language.code).apply()
        _settings.value = readSnapshot()
    }

    fun setVoiceInputLocale(locale: VoiceInputLocale) {
        prefs.edit().putString(KEY_VOICE_INPUT_LOCALE, locale.tag).apply()
        _settings.value = readSnapshot()
    }

    fun setAiEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AI_ENABLED, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setKeepAliveEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_KEEP_ALIVE, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setNotificationReaderEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_READER_ENABLED, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setHeadphoneOnlyMode(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_HEADPHONE_ONLY, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setIgnoreGroups(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_IGNORE_GROUPS, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setIgnoreMuted(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_IGNORE_MUTED, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setQuietHours(enabled: Boolean, start: String = "22:00", end: String = "07:00") {
        prefs.edit()
            .putBoolean(KEY_QUIET_HOURS, enabled)
            .putString(KEY_QUIET_START, start)
            .putString(KEY_QUIET_END, end)
            .apply()
        _settings.value = readSnapshot()
    }

    fun setVipBypassQuietHours(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_VIP_BYPASS_QUIET, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setVoiceTuning(rate: Float, pitch: Float) {
        prefs.edit()
            .putFloat(KEY_VOICE_RATE, rate.coerceIn(0.6f, 1.6f))
            .putFloat(KEY_VOICE_PITCH, pitch.coerceIn(0.6f, 1.5f))
            .apply()
        _settings.value = readSnapshot()
    }

    fun setCallAnnouncerEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_CALL_ANNOUNCER, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setCallerOverlayEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_CALLER_OVERLAY, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setSilenceMarkedSpamCalls(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_SILENCE_SPAM, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setRejectMarkedSpamCalls(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_REJECT_SPAM, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setFloatingMicEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_FLOATING_MIC, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setWakeWordEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_WAKE_WORD, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setMorningBriefingEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_MORNING_BRIEFING_ENABLED, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setMorningBriefingTime(hhMm: String) {
        prefs.edit().putString(KEY_MORNING_BRIEFING_TIME, hhMm).apply()
        _settings.value = readSnapshot()
    }

    fun setSpeakBriefingOnUnlock(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_SPEAK_BRIEFING_ON_UNLOCK, enabled).apply()
        _settings.value = readSnapshot()
    }

    fun setLastBriefingSpokenDate(isoDate: String) {
        prefs.edit().putString(KEY_LAST_BRIEFING_DATE, isoDate).apply()
        _settings.value = readSnapshot()
    }

    fun setRetentionWindow(window: RetentionWindow) {
        prefs.edit().putInt(KEY_RETENTION_HOURS, window.hours).apply()
        _settings.value = readSnapshot()
    }

    fun setGeminiApiKey(apiKey: String) {
        val trimmed = apiKey.trim()
        prefs.edit().putString(KEY_GEMINI_API_KEY, trimmed).apply()
        _settings.value = readSnapshot()
    }

    fun getGeminiApiKey(): String? {
        return prefs.getString(KEY_GEMINI_API_KEY, null)?.takeIf { it.isNotBlank() }
    }

    fun clearAll() {
        prefs.edit().clear().apply()
        _settings.value = readSnapshot()
    }

    companion object {
        private const val KEY_ONBOARDING_DONE = "onboarding_done"
        private const val KEY_LANGUAGE = "app_language"
        private const val KEY_VOICE_INPUT_LOCALE = "voice_input_locale"
        private const val KEY_AI_ENABLED = "ai_enabled"
        private const val KEY_GEMINI_API_KEY = "gemini_api_key"
        private const val KEY_KEEP_ALIVE = "keep_alive_enabled"
        private const val KEY_READER_ENABLED = "reader_enabled"
        private const val KEY_HEADPHONE_ONLY = "headphone_only_mode"
        private const val KEY_IGNORE_GROUPS = "ignore_groups"
        private const val KEY_IGNORE_MUTED = "ignore_muted"
        private const val KEY_QUIET_HOURS = "quiet_hours_enabled"
        private const val KEY_QUIET_START = "quiet_hours_start"
        private const val KEY_QUIET_END = "quiet_hours_end"
        private const val KEY_VIP_BYPASS_QUIET = "vip_bypass_quiet"
        private const val KEY_VOICE_RATE = "voice_rate"
        private const val KEY_VOICE_PITCH = "voice_pitch"
        private const val KEY_CALL_ANNOUNCER = "call_announcer_enabled"
        private const val KEY_CALLER_OVERLAY = "caller_overlay_enabled"
        private const val KEY_SILENCE_SPAM = "silence_marked_spam"
        private const val KEY_REJECT_SPAM = "reject_marked_spam"
        private const val KEY_FLOATING_MIC = "floating_mic_enabled"
        private const val KEY_WAKE_WORD = "wake_word_enabled"
        private const val KEY_MORNING_BRIEFING_ENABLED = "morning_briefing_enabled"
        private const val KEY_MORNING_BRIEFING_TIME = "morning_briefing_time"
        private const val KEY_SPEAK_BRIEFING_ON_UNLOCK = "speak_briefing_on_unlock"
        private const val KEY_LAST_BRIEFING_DATE = "last_briefing_date"
        private const val KEY_RETENTION_HOURS = "retention_hours"
    }
}
