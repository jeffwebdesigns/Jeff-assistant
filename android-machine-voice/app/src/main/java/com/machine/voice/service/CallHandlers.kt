package com.machine.voice.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.telecom.Call
import android.telecom.CallScreeningService
import android.telephony.TelephonyManager
import com.machine.voice.calls.CallerLookupResult
import com.machine.voice.calls.LocalCallerIdResolver
import com.machine.voice.data.local.MachineDatabase
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.SecurePrefs
import com.machine.voice.speech.SpeechQueueManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

object CallAnnounceCoordinator {
    @Volatile
    private var lastHandledKey: String = ""
    @Volatile
    private var lastHandledAt: Long = 0L

    fun shouldHandleRing(normalizedNumber: String): Boolean {
        val now = System.currentTimeMillis()
        val key = normalizedNumber.ifEmpty { "PRIVATE" }
        if (key == lastHandledKey && (now - lastHandledAt) < 5500L) {
            return false
        }
        lastHandledKey = key
        lastHandledAt = now
        return true
    }

    fun handleIncomingResolved(
        context: Context,
        result: CallerLookupResult
    ) {
        val prefs = SecurePrefs(context)
        val settings = prefs.settings.value
        val speechQueue = SpeechQueueManager.getInstance(context)

        val primaryLabel = result.contactName
            ?: result.customTag
            ?: if (result.rawNumber.equals("Private Number", ignoreCase = true)) {
                "Private Number"
            } else {
                "Unknown Caller"
            }

        val tagLine = buildString {
            if (!result.customTag.isNullOrBlank()) {
                append(result.customTag)
            }
            if (result.isSpam) {
                if (isNotEmpty()) append(" · ")
                append("Marked Spam")
            }
        }

        if (settings.callerOverlayEnabled && Settings.canDrawOverlays(context)) {
            VoiceOverlayService.showIncomingCallCard(
                context = context,
                title = primaryLabel,
                number = result.displayNumber,
                tag = tagLine,
                history = result.lastCallSummary,
                isSpam = result.isSpam
            )
        }

        if (!settings.callAnnouncerEnabled) return
        if (settings.headphoneOnlyMode && !speechQueue.areHeadphonesOrBluetoothConnected()) return

        val lang = settings.language
        val spokenText = buildCallAnnouncement(result, lang)
        speechQueue.enqueue(text = spokenText, language = lang, pauseDuringCall = false)
    }

    private fun buildCallAnnouncement(result: CallerLookupResult, lang: AppLanguage): String {
        val contact = result.contactName
        val tag = result.customTag
        return if (lang == AppLanguage.SWAHILI) {
            when {
                result.isSpam -> "Tahadhari, simu ya usumbufu kutoka ${contact ?: result.displayNumber}."
                contact != null && !tag.isNullOrBlank() -> "Simu kutoka kwa $contact, lebo: $tag."
                contact != null -> "Simu kutoka kwa $contact."
                !tag.isNullOrBlank() -> "Simu kutoka $tag, namba ${LocalCallerIdResolver.formatDigitsForSpeech(result.displayNumber)}."
                else -> "Namba isiyojulikana, ${LocalCallerIdResolver.formatDigitsForSpeech(result.displayNumber)}."
            }
        } else {
            when {
                result.isSpam -> "Warning, personal spam call from ${contact ?: result.displayNumber}."
                contact != null && !tag.isNullOrBlank() -> "Call from $contact, tagged $tag."
                contact != null -> "Call from $contact."
                !tag.isNullOrBlank() -> "Call from $tag, number ${LocalCallerIdResolver.formatDigitsForSpeech(result.displayNumber)}."
                else -> "Unknown number, ${LocalCallerIdResolver.formatDigitsForSpeech(result.displayNumber)}."
            }
        }
    }
}

class MachineCallScreeningService : CallScreeningService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onScreenCall(callDetails: Call.Details) {
        if (callDetails.callDirection != Call.Details.DIRECTION_INCOMING) {
            respondToCall(callDetails, CallResponse.Builder().build())
            return
        }

        val rawNumber = callDetails.handle?.schemeSpecificPart.orEmpty()
        val normalized = LocalCallerIdResolver.normalizeNumber(rawNumber)
        val prefs = SecurePrefs(applicationContext)
        val settings = prefs.settings.value
        val database = MachineDatabase.getInstance(applicationContext)

        scope.launch {
            val resolved = LocalCallerIdResolver.resolveIncomingCaller(
                context = applicationContext,
                rawNumber = rawNumber,
                callerTagDao = database.callerTagDao()
            )

            val shouldSilence = resolved.isSpam && settings.silenceMarkedSpamCalls
            val shouldReject = resolved.isSpam && settings.rejectMarkedSpamCalls

            val response = CallResponse.Builder()
                .setDisallowCall(shouldReject)
                .setRejectCall(shouldReject)
                .setSilenceCall(shouldSilence || shouldReject)
                .setSkipCallLog(false)
                .setSkipNotification(shouldReject)
                .build()

            respondToCall(callDetails, response)

            if (!shouldReject && CallAnnounceCoordinator.shouldHandleRing(normalized)) {
                CallAnnounceCoordinator.handleIncomingResolved(applicationContext, resolved)
            }
        }
    }
}

class IncomingCallReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return

        when (state) {
            TelephonyManager.EXTRA_STATE_IDLE,
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                VoiceOverlayService.dismissIncomingCallCard(context)
            }

            TelephonyManager.EXTRA_STATE_RINGING -> {
                @Suppress("DEPRECATION")
                val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER).orEmpty()
                val normalized = LocalCallerIdResolver.normalizeNumber(incomingNumber)
                if (!CallAnnounceCoordinator.shouldHandleRing(normalized)) {
                    return
                }

                val pending = goAsync()
                val appContext = context.applicationContext
                CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                    try {
                        val db = MachineDatabase.getInstance(appContext)
                        val resolved = LocalCallerIdResolver.resolveIncomingCaller(
                            context = appContext,
                            rawNumber = incomingNumber,
                            callerTagDao = db.callerTagDao()
                        )
                        CallAnnounceCoordinator.handleIncomingResolved(appContext, resolved)
                    } finally {
                        pending.finish()
                    }
                }
            }
        }
    }
}
