package com.machine.voice.speech

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.SecurePrefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue

data class SpeechItem(
    val text: String,
    val language: AppLanguage,
    val pauseDuringCall: Boolean = true,
    val rateOverride: Float? = null,
    val pitchOverride: Float? = null
)

class SpeechQueueManager private constructor(private val appContext: Context) {

    private val queue = ConcurrentLinkedQueue<SpeechItem>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val audioManager = appContext.getSystemService(AudioManager::class.java)
    private val securePrefs = SecurePrefs(appContext)

    private var tts: TextToSpeech? = null
    @Volatile
    private var ttsReady = false
    @Volatile
    private var currentlySpeaking = false
    private var focusRequest: AudioFocusRequest? = null

    private val _isSpeaking = MutableStateFlow(false)
    val isSpeaking: StateFlow<Boolean> = _isSpeaking.asStateFlow()

    private val _queueSize = MutableStateFlow(0)
    val queueSize: StateFlow<Int> = _queueSize.asStateFlow()

    private val callRetryRunnable = Runnable { processNext() }

    init {
        initTts()
    }

    private fun initTts() {
        ttsReady = false
        tts = TextToSpeech(appContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true
                tts?.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {
                        _isSpeaking.value = true
                    }

                    override fun onDone(utteranceId: String?) {
                        onUtteranceFinished()
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) {
                        onUtteranceFinished()
                    }

                    override fun onError(utteranceId: String?, errorCode: Int) {
                        onUtteranceFinished()
                    }
                })
                mainHandler.post { processNext() }
            }
        }
    }

    fun enqueue(
        text: String,
        language: AppLanguage,
        pauseDuringCall: Boolean = true,
        rateOverride: Float? = null,
        pitchOverride: Float? = null
    ) {
        val cleaned = text.trim()
        if (cleaned.isEmpty()) return
        queue.add(
            SpeechItem(
                text = cleaned,
                language = language,
                pauseDuringCall = pauseDuringCall,
                rateOverride = rateOverride,
                pitchOverride = pitchOverride
            )
        )
        _queueSize.value = queue.size
        mainHandler.post { processNext() }
    }

    fun stopAll() {
        queue.clear()
        _queueSize.value = 0
        mainHandler.removeCallbacks(callRetryRunnable)
        currentlySpeaking = false
        _isSpeaking.value = false
        try {
            tts?.stop()
        } catch (_: Exception) {
        }
        abandonAudioFocus()
    }

    fun isInActiveCall(): Boolean {
        val audioMode = audioManager?.mode
        if (audioMode == AudioManager.MODE_IN_CALL || audioMode == AudioManager.MODE_IN_COMMUNICATION) {
            return true
        }
        if (ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_PHONE_STATE)
            == PackageManager.PERMISSION_GRANTED
        ) {
            val tm = appContext.getSystemService(TelephonyManager::class.java)
            @Suppress("DEPRECATION")
            val state = tm?.callState ?: TelephonyManager.CALL_STATE_IDLE
            if (state == TelephonyManager.CALL_STATE_OFFHOOK) {
                return true
            }
        }
        return false
    }

    fun areHeadphonesOrBluetoothConnected(): Boolean {
        val devices = audioManager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: return false
        return devices.any { device ->
            when (device.type) {
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> true
                else -> Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    (device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                        device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER)
            }
        }
    }

    private fun processNext() {
        if (!ttsReady || currentlySpeaking) return
        val next = queue.peek() ?: run {
            abandonAudioFocus()
            _isSpeaking.value = false
            return
        }

        if (next.pauseDuringCall && isInActiveCall()) {
            // Defer politely while owner is on an active call
            mainHandler.removeCallbacks(callRetryRunnable)
            mainHandler.postDelayed(callRetryRunnable, 4000L)
            return
        }

        val item = queue.poll() ?: return
        _queueSize.value = queue.size

        val settings = securePrefs.settings.value
        val locale = selectBestLocale(item.language)
        tts?.language = locale
        tts?.setSpeechRate(item.rateOverride ?: settings.voiceRate)
        tts?.setPitch(item.pitchOverride ?: settings.voicePitch)

        requestAudioFocus()
        currentlySpeaking = true
        _isSpeaking.value = true

        val utteranceId = UUID.randomUUID().toString()
        val result = tts?.speak(item.text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        if (result == TextToSpeech.ERROR) {
            currentlySpeaking = false
            _isSpeaking.value = false
            initTts()
        }
    }

    private fun onUtteranceFinished() {
        currentlySpeaking = false
        if (queue.isEmpty()) {
            _isSpeaking.value = false
            abandonAudioFocus()
        } else {
            mainHandler.post { processNext() }
        }
    }

    private fun selectBestLocale(language: AppLanguage): Locale {
        val engine = tts ?: return Locale.US
        val candidates = when (language) {
            AppLanguage.SWAHILI -> listOf(
                Locale("sw", "KE"),
                Locale("sw", "TZ"),
                Locale("sw"),
                Locale("en", "KE"),
                Locale.US
            )
            AppLanguage.ENGLISH -> listOf(
                Locale("en", "KE"),
                Locale.UK,
                Locale.US
            )
        }
        for (loc in candidates) {
            val res = engine.isLanguageAvailable(loc)
            if (res == TextToSpeech.LANG_AVAILABLE ||
                res == TextToSpeech.LANG_COUNTRY_AVAILABLE ||
                res == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE
            ) {
                return loc
            }
        }
        return Locale.US
    }

    private fun requestAudioFocus() {
        val am = audioManager ?: return
        if (focusRequest != null) return
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .build()
        focusRequest = req
        am.requestAudioFocus(req)
    }

    private fun abandonAudioFocus() {
        val req = focusRequest ?: return
        audioManager?.abandonAudioFocusRequest(req)
        focusRequest = null
    }

    companion object {
        @Volatile
        private var INSTANCE: SpeechQueueManager? = null

        fun getInstance(context: Context): SpeechQueueManager {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: SpeechQueueManager(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
}
