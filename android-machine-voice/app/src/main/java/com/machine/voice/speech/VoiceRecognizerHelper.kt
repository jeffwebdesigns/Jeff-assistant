package com.machine.voice.speech

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Interface for optional, battery-conscious wake-word detection.
 * Allows swapping the free Android platform SpeechRecognizer loop with
 * an offline engine (such as Porcupine / Vosk) without changing callers.
 */
interface WakeWordDetector {
    val isRunning: StateFlow<Boolean>
    fun start(localeTag: String, onWakePhraseDetected: () -> Unit)
    fun stop()
}

class VoiceRecognizerHelper(private val appContext: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null

    private val _isListening = MutableStateFlow(false)
    val isListening: StateFlow<Boolean> = _isListening.asStateFlow()

    private val _partialText = MutableStateFlow("")
    val partialText: StateFlow<String> = _partialText.asStateFlow()

    private val _rmsLevel = MutableStateFlow(0f)
    val rmsLevel: StateFlow<Float> = _rmsLevel.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    private var onFinalCallback: ((String) -> Unit)? = null

    fun hasAudioPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun startListening(localeTag: String, onFinalResult: (String) -> Unit) {
        if (!hasAudioPermission()) {
            _lastError.value = "Microphone permission is required for voice commands."
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(appContext)) {
            _lastError.value = "Speech recognition service is unavailable on this device."
            return
        }

        // Prevent assistant TTS from feeding into the microphone
        SpeechQueueManager.getInstance(appContext).stopAll()

        mainHandler.post {
            stopInternalLocked()
            onFinalCallback = onFinalResult
            _partialText.value = ""
            _lastError.value = null

            val sr = try {
                SpeechRecognizer.createSpeechRecognizer(appContext)
            } catch (e: Exception) {
                _lastError.value = "Unable to start speech recognizer: ${e.message ?: "unknown error"}"
                null
            } ?: return@post

            recognizer = sr
            sr.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    _isListening.value = true
                    _lastError.value = null
                }

                override fun onBeginningOfSpeech() {
                    _isListening.value = true
                }

                override fun onRmsChanged(rmsdB: Float) {
                    _rmsLevel.value = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
                }

                override fun onBufferReceived(buffer: ByteArray?) = Unit

                override fun onEndOfSpeech() {
                    _isListening.value = false
                    _rmsLevel.value = 0f
                }

                override fun onError(error: Int) {
                    _isListening.value = false
                    _rmsLevel.value = 0f
                    _lastError.value = mapSpeechError(error)
                }

                override fun onResults(results: Bundle?) {
                    _isListening.value = false
                    _rmsLevel.value = 0f
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    val best = matches?.firstOrNull()?.trim().orEmpty()
                    _partialText.value = best
                    if (best.isNotEmpty()) {
                        onFinalCallback?.invoke(best)
                    } else {
                        _lastError.value = "No speech detected. Try speaking closer to the microphone."
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    val partial = matches?.firstOrNull()?.trim().orEmpty()
                    if (partial.isNotEmpty()) {
                        _partialText.value = partial
                    }
                }

                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeTag)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, localeTag)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, appContext.packageName)
            }

            try {
                sr.startListening(intent)
                _isListening.value = true
            } catch (e: Exception) {
                _isListening.value = false
                _lastError.value = "Microphone listen failed: ${e.message ?: "error"}"
            }
        }
    }

    fun stopListening() {
        mainHandler.post {
            try {
                recognizer?.stopListening()
            } catch (_: Exception) {
            }
            _isListening.value = false
            _rmsLevel.value = 0f
        }
    }

    fun clearError() {
        _lastError.value = null
    }

    fun destroy() {
        mainHandler.post { stopInternalLocked() }
    }

    private fun stopInternalLocked() {
        try {
            recognizer?.cancel()
            recognizer?.destroy()
        } catch (_: Exception) {
        }
        recognizer = null
        _isListening.value = false
        _rmsLevel.value = 0f
    }

    private fun mapSpeechError(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_AUDIO -> "Audio recording error."
        SpeechRecognizer.ERROR_CLIENT -> "Voice recognition cancelled."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required."
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech network timeout. Check connection or offline speech pack."
        SpeechRecognizer.ERROR_NO_MATCH -> "Could not understand speech. Try again or type your request."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer is busy. Retrying in a moment."
        SpeechRecognizer.ERROR_SERVER -> "Speech recognizer server error."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech heard before timeout."
        else -> "Voice input error ($code)."
    }
}

/**
 * Optional free-tier "Hey Machine" wake-word loop powered by Android's SpeechRecognizer.
 * Clearly flagged as optional due to battery impact. Automatically defers while calls
 * or active assistant TTS are playing.
 */
class AndroidSpeechWakeWordDetector(private val appContext: Context) : WakeWordDetector {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var activeLocaleTag = "en-KE"
    private var wakeCallback: (() -> Unit)? = null
    private var shouldRun = false

    private val _isRunning = MutableStateFlow(false)
    override val isRunning: StateFlow<Boolean> = _isRunning.asStateFlow()

    private val restartRunnable = Runnable {
        if (shouldRun) {
            listenOnce()
        }
    }

    override fun start(localeTag: String, onWakePhraseDetected: () -> Unit) {
        if (ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.RECORD_AUDIO
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            stop()
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(appContext)) {
            stop()
            return
        }
        activeLocaleTag = localeTag
        wakeCallback = onWakePhraseDetected
        shouldRun = true
        _isRunning.value = true
        mainHandler.removeCallbacks(restartRunnable)
        mainHandler.post { listenOnce() }
    }

    override fun stop() {
        shouldRun = false
        _isRunning.value = false
        mainHandler.removeCallbacks(restartRunnable)
        mainHandler.post { destroyRecognizer() }
    }

    private fun listenOnce() {
        if (!shouldRun) return
        val speechQueue = SpeechQueueManager.getInstance(appContext)
        if (speechQueue.isInActiveCall() || speechQueue.isSpeaking.value) {
            scheduleRestart(2500L)
            return
        }

        destroyRecognizer()
        val sr = try {
            SpeechRecognizer.createSpeechRecognizer(appContext)
        } catch (_: Exception) {
            scheduleRestart(3000L)
            return
        }
        recognizer = sr
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit

            override fun onError(error: Int) {
                val delay = if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                    stop()
                    return
                } else {
                    1800L
                }
                scheduleRestart(delay)
            }

            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                if (matches.any { containsWakePhrase(it) }) {
                    stop()
                    wakeCallback?.invoke()
                } else {
                    scheduleRestart(1000L)
                }
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                if (matches.any { containsWakePhrase(it) }) {
                    stop()
                    wakeCallback?.invoke()
                }
            }

            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, activeLocaleTag)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 2)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, appContext.packageName)
        }
        try {
            sr.startListening(intent)
        } catch (_: Exception) {
            scheduleRestart(2500L)
        }
    }

    private fun scheduleRestart(delayMs: Long) {
        if (!shouldRun) return
        mainHandler.removeCallbacks(restartRunnable)
        mainHandler.postDelayed(restartRunnable, delayMs)
    }

    private fun destroyRecognizer() {
        try {
            recognizer?.cancel()
            recognizer?.destroy()
        } catch (_: Exception) {
        }
        recognizer = null
    }

    private fun containsWakePhrase(phrase: String): Boolean {
        val clean = phrase.lowercase().trim()
        return clean.contains("hey machine") ||
            clean.contains("okay machine") ||
            clean.contains("ok machine") ||
            clean.contains("hello machine") ||
            clean == "machine"
    }
}
