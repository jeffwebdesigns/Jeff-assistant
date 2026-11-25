package com.machine.voice.notifications

import com.machine.voice.data.prefs.AppLanguage

data class ShieldResult(
    val isSensitive: Boolean,
    val redactedText: String
)

object SensitiveContentShield {

    private val otpKeywordRegex = Regex(
        "\\b(otp|one[-\\s]?time\\s*(password|passcode|pin|code)|verification\\s*code|security\\s*code|auth(entication)?\\s*code|2fa|cvv|cvc|pin\\s*(is|code|number|:)?|secret\\s*code|namba\\s*ya\\s*siri|msimbo\\s*(wa)?\\s*uthibitisho|hakikisha)\\b",
        RegexOption.IGNORE_CASE
    )

    // Matches 4-8 digit standalone codes often preceded by whitespace/colon/#
    private val numericCodeRegex = Regex("(?<![\\d.])\\d{4,8}(?![\\d.])")

    // Matches 13-19 digit payment card sequences with optional spaces or hyphens
    private val cardNumberRegex = Regex("\\b(?:\\d[ -]*?){13,19}\\b")

    fun inspectAndRedact(rawText: String): ShieldResult {
        val text = rawText.trim()
        if (text.isEmpty()) return ShieldResult(false, "")

        val hasCardNumber = cardNumberRegex.containsMatchIn(text)
        val hasOtpContext = otpKeywordRegex.containsMatchIn(text) && numericCodeRegex.containsMatchIn(text)

        if (!hasCardNumber && !hasOtpContext) {
            return ShieldResult(false, text)
        }

        var redacted = cardNumberRegex.replace(text, "[CARD NUMBER SHIELDED]")
        if (hasOtpContext) {
            redacted = numericCodeRegex.replace(redacted, "[CODE SHIELDED]")
        }
        return ShieldResult(true, redacted)
    }
}

object LanguageDetector {

    private val swahiliMarkers = setOf(
        "habari", "hujambo", "sijambo", "asante", "karibu", "tafadhali",
        "sasa", "mambo", "poa", "leo", "kesho", "jana", "sawa", "ndiyo",
        "hapana", "samahani", "naomba", "niko", "wapi", "lini", "nani",
        "tuma", "pesa", "fedha", "kazi", "nyumbani", "asubuhi", "jioni",
        "usiku", "mchana", "kwamba", "lakini", "kwani", "bado", "sana",
        "mzuri", "vizuri", "tafuta", "piga", "simu", "ujumbe", "ndugu",
        "rafiki", "bwana", "dada", "mama", "baba", "haya", "nakuja"
    )

    fun detectLanguage(text: String, fallback: AppLanguage): AppLanguage {
        val tokens = text.lowercase()
            .split(Regex("[^a-z']+"))
            .filter { it.isNotBlank() }

        if (tokens.isEmpty()) return fallback

        val swahiliHits = tokens.count { it in swahiliMarkers }
        return when {
            swahiliHits >= 2 -> AppLanguage.SWAHILI
            swahiliHits == 1 && tokens.size <= 6 -> AppLanguage.SWAHILI
            else -> AppLanguage.ENGLISH
        }
    }
}
