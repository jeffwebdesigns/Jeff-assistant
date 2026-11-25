package com.machine.voice.service

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.machine.voice.MachineVoiceApp
import com.machine.voice.MainActivity
import com.machine.voice.data.prefs.OwnerSettings
import com.machine.voice.data.prefs.SecurePrefs
import com.machine.voice.speech.AndroidSpeechWakeWordDetector
import com.machine.voice.speech.SpeechQueueManager
import com.machine.voice.speech.WakeWordDetector
import kotlin.math.abs

class VoiceOverlayService : Service() {

    private var windowManager: WindowManager? = null
    private var callOverlayView: View? = null
    private var floatingMicView: View? = null
    private var wakeWordDetector: WakeWordDetector? = null
    private var wakeWordActive = false

    private val mainHandler = Handler(Looper.getMainLooper())
    private val autoDismissCallRunnable = Runnable {
        removeCallOverlayViewOnly()
        stopSelfIfIdle()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WindowManager::class.java)
        wakeWordDetector = AndroidSpeechWakeWordDetector(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DISMISS_CALL_CARD -> {
                mainHandler.post {
                    mainHandler.removeCallbacks(autoDismissCallRunnable)
                    removeCallOverlayViewOnly()
                    stopSelfIfIdle()
                }
                return START_NOT_STICKY
            }

            ACTION_SHOW_CALL_CARD -> {
                ensureForeground(useMicrophoneType = wakeWordActive)
                if (!Settings.canDrawOverlays(this)) {
                    stopSelfIfIdle()
                    return START_NOT_STICKY
                }
                val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "UNKNOWN CALLER" }
                val number = intent.getStringExtra(EXTRA_NUMBER).orEmpty()
                val tag = intent.getStringExtra(EXTRA_TAG).orEmpty()
                val history = intent.getStringExtra(EXTRA_HISTORY).orEmpty()
                val isSpam = intent.getBooleanExtra(EXTRA_IS_SPAM, false)

                mainHandler.post {
                    showGoldCallCard(
                        title = title,
                        number = number,
                        tag = tag,
                        history = history,
                        isSpam = isSpam
                    )
                }
                return START_NOT_STICKY
            }

            ACTION_SHOW_FLOATING_MIC -> {
                val prefs = SecurePrefs(applicationContext).settings.value
                val micWant = prefs.floatingMicEnabled && Settings.canDrawOverlays(this)
                val wakeWant = prefs.wakeWordEnabled && hasRecordAudioPermission()
                ensureForeground(useMicrophoneType = wakeWant)

                mainHandler.post {
                    if (micWant) {
                        showFloatingMicButton()
                    } else {
                        removeFloatingMicOnly()
                    }
                    syncWakeWordState(wakeWant, prefs.voiceInputLocale.tag)
                    stopSelfIfIdle()
                }
                return START_STICKY
            }

            ACTION_HIDE_FLOATING_MIC -> {
                mainHandler.post {
                    removeFloatingMicOnly()
                    stopWakeWord()
                    stopSelfIfIdle()
                }
                return START_NOT_STICKY
            }

            ACTION_SYNC_VOICE_CONTROLS -> {
                val prefs = SecurePrefs(applicationContext).settings.value
                val micWant = prefs.floatingMicEnabled && Settings.canDrawOverlays(this)
                val wakeWant = prefs.wakeWordEnabled && hasRecordAudioPermission()

                if (!micWant && !wakeWant && callOverlayView == null) {
                    mainHandler.post {
                        removeFloatingMicOnly()
                        stopWakeWord()
                        stopSelfIfIdle()
                    }
                    return START_NOT_STICKY
                }

                ensureForeground(useMicrophoneType = wakeWant)
                mainHandler.post {
                    if (micWant) {
                        showFloatingMicButton()
                    } else {
                        removeFloatingMicOnly()
                    }
                    syncWakeWordState(wakeWant, prefs.voiceInputLocale.tag)
                    stopSelfIfIdle()
                }
                return if (micWant || wakeWant) START_STICKY else START_NOT_STICKY
            }

            else -> {
                stopSelfIfIdle()
                return START_NOT_STICKY
            }
        }
    }

    private fun hasRecordAudioPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun ensureForeground(useMicrophoneType: Boolean) {
        val openIntent = PendingIntent.getActivity(
            this,
            2,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val contentText = when {
            wakeWordActive -> "Floating voice mic & 'Hey Machine' wake word active"
            floatingMicView != null -> "Floating gold voice button active"
            else -> "Machine Voice overlay active"
        }

        val notification = NotificationCompat.Builder(this, MachineVoiceApp.CHANNEL_KEEP_ALIVE)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Machine Voice Controls")
            .setContentText(contentText)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val fgsType = if (useMicrophoneType && hasRecordAudioPermission()) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            }
            startForeground(OVERLAY_NOTIFICATION_ID, notification, fgsType)
        } else {
            startForeground(OVERLAY_NOTIFICATION_ID, notification)
        }
    }

    private fun syncWakeWordState(enable: Boolean, localeTag: String) {
        if (enable && hasRecordAudioPermission()) {
            wakeWordActive = true
            wakeWordDetector?.start(localeTag) {
                launchVoiceAssistantScreen()
                // Resume wake listening cleanly after short grace period if still enabled
                mainHandler.postDelayed({
                    val latest = SecurePrefs(applicationContext).settings.value
                    if (latest.wakeWordEnabled && hasRecordAudioPermission()) {
                        wakeWordDetector?.start(latest.voiceInputLocale.tag) {
                            launchVoiceAssistantScreen()
                        }
                    } else {
                        wakeWordActive = false
                        stopSelfIfIdle()
                    }
                }, 6000L)
            }
        } else {
            stopWakeWord()
        }
    }

    private fun stopWakeWord() {
        wakeWordActive = false
        wakeWordDetector?.stop()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun showFloatingMicButton() {
        if (floatingMicView != null || !Settings.canDrawOverlays(this)) return

        val density = resources.displayMetrics.density
        fun dp(value: Int): Int = (value * density).toInt()

        val circleSize = dp(56)
        val circleDrawable = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#E6141414"))
            setStroke(dp(2), Color.parseColor("#D4AF37"))
        }

        val iconView = ImageView(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            setColorFilter(Color.parseColor("#F5D77A"))
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }

        val container = FrameLayout(this).apply {
            background = circleDrawable
            elevation = dp(8).toFloat()
            addView(
                iconView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
            contentDescription = "Ask Machine Voice"
        }

        val params = WindowManager.LayoutParams(
            circleSize,
            circleSize,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = resources.displayMetrics.widthPixels - circleSize - dp(14)
            y = (resources.displayMetrics.heightPixels * 0.62f).toInt()
        }

        var initialX = 0
        var initialY = 0
        var touchStartX = 0f
        var touchStartY = 0f
        var moved = false

        container.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    touchStartX = event.rawX
                    touchStartY = event.rawY
                    moved = false
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - touchStartX).toInt()
                    val dy = (event.rawY - touchStartY).toInt()
                    if (abs(dx) > 8 || abs(dy) > 8) {
                        moved = true
                    }
                    params.x = initialX + dx
                    params.y = initialY + dy
                    try {
                        windowManager?.updateViewLayout(container, params)
                    } catch (_: Exception) {
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    if (!moved) {
                        launchVoiceAssistantScreen()
                    }
                    true
                }

                else -> false
            }
        }

        try {
            windowManager?.addView(container, params)
            floatingMicView = container
        } catch (_: Exception) {
            floatingMicView = null
        }
    }

    private fun launchVoiceAssistantScreen() {
        val intent = Intent(this, MainActivity::class.java).apply {
            action = MainActivity.ACTION_TRIGGER_VOICE
            putExtra(MainActivity.EXTRA_TRIGGER_VOICE, true)
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
        }
    }

    private fun showGoldCallCard(
        title: String,
        number: String,
        tag: String,
        history: String,
        isSpam: Boolean
    ) {
        removeCallOverlayViewOnly()
        mainHandler.removeCallbacks(autoDismissCallRunnable)

        val density = resources.displayMetrics.density
        fun dp(value: Int): Int = (value * density).toInt()

        val borderColor = if (isSpam) Color.parseColor("#EF4444") else Color.parseColor("#D4AF37")
        val goldText = Color.parseColor("#F5D77A")
        val ivoryText = Color.parseColor("#F5F0E1")
        val mutedIvory = Color.parseColor("#B3AC99")

        val cardBg = GradientDrawable().apply {
            setColor(Color.parseColor("#EB0A0A0A"))
            cornerRadius = dp(16).toFloat()
            setStroke(dp(2), borderColor)
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBg
            setPadding(dp(18), dp(14), dp(18), dp(14))
        }

        val headerText = TextView(this).apply {
            text = if (isSpam) "MACHINE VOICE · PERSONAL SPAM" else "MACHINE VOICE · CALLER ID"
            setTextColor(borderColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.MONOSPACE
            letterSpacing = 0.08f
        }
        container.addView(headerText)

        val callerTitleView = TextView(this).apply {
            text = title
            setTextColor(goldText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
            setPadding(0, dp(4), 0, dp(2))
        }
        container.addView(callerTitleView)

        if (number.isNotBlank() && number != title) {
            val numView = TextView(this).apply {
                text = number
                setTextColor(ivoryText)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            }
            container.addView(numView)
        }

        if (tag.isNotBlank()) {
            val tagView = TextView(this).apply {
                text = "TAG: $tag"
                setTextColor(if (isSpam) Color.parseColor("#FCA5A5") else goldText)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                setPadding(0, dp(6), 0, 0)
            }
            container.addView(tagView)
        }

        if (history.isNotBlank()) {
            val historyView = TextView(this).apply {
                text = history
                setTextColor(mutedIvory)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(0, dp(4), 0, dp(10))
            }
            container.addView(historyView)
        }

        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(6), 0, 0)
        }

        val muteBtn = Button(this).apply {
            text = "MUTE VOICE"
            setTextColor(goldText)
            setBackgroundColor(Color.parseColor("#1A1814"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setOnClickListener {
                SpeechQueueManager.getInstance(applicationContext).stopAll()
            }
        }
        val dismissBtn = Button(this).apply {
            text = "DISMISS"
            setTextColor(Color.parseColor("#0A0A0A"))
            setBackgroundColor(borderColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setOnClickListener {
                removeCallOverlayViewOnly()
                stopSelfIfIdle()
            }
        }

        buttonRow.addView(
            muteBtn,
            LinearLayout.LayoutParams(0, dp(40), 1f).apply { rightMargin = dp(8) }
        )
        buttonRow.addView(
            dismissBtn,
            LinearLayout.LayoutParams(0, dp(40), 1f)
        )
        container.addView(buttonRow)

        val params = WindowManager.LayoutParams(
            resources.displayMetrics.widthPixels - dp(28),
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dp(64)
        }

        try {
            windowManager?.addView(container, params)
            callOverlayView = container
            mainHandler.postDelayed(autoDismissCallRunnable, 35_000L)
        } catch (_: Exception) {
            stopSelfIfIdle()
        }
    }

    private fun removeCallOverlayViewOnly() {
        val current = callOverlayView ?: return
        try {
            windowManager?.removeView(current)
        } catch (_: Exception) {
        }
        callOverlayView = null
    }

    private fun removeFloatingMicOnly() {
        val current = floatingMicView ?: return
        try {
            windowManager?.removeView(current)
        } catch (_: Exception) {
        }
        floatingMicView = null
    }

    private fun stopSelfIfIdle() {
        if (callOverlayView == null && floatingMicView == null && !wakeWordActive) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(autoDismissCallRunnable)
        removeCallOverlayViewOnly()
        removeFloatingMicOnly()
        stopWakeWord()
        super.onDestroy()
    }

    companion object {
        private const val OVERLAY_NOTIFICATION_ID = 1002
        const val ACTION_SHOW_CALL_CARD = "com.machine.voice.ACTION_SHOW_CALL_CARD"
        const val ACTION_DISMISS_CALL_CARD = "com.machine.voice.ACTION_DISMISS_CALL_CARD"
        const val ACTION_SHOW_FLOATING_MIC = "com.machine.voice.ACTION_SHOW_FLOATING_MIC"
        const val ACTION_HIDE_FLOATING_MIC = "com.machine.voice.ACTION_HIDE_FLOATING_MIC"
        const val ACTION_SYNC_VOICE_CONTROLS = "com.machine.voice.ACTION_SYNC_VOICE_CONTROLS"

        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_NUMBER = "extra_number"
        const val EXTRA_TAG = "extra_tag"
        const val EXTRA_HISTORY = "extra_history"
        const val EXTRA_IS_SPAM = "extra_is_spam"

        fun showIncomingCallCard(
            context: Context,
            title: String,
            number: String,
            tag: String,
            history: String,
            isSpam: Boolean
        ) {
            val intent = Intent(context, VoiceOverlayService::class.java).apply {
                action = ACTION_SHOW_CALL_CARD
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_NUMBER, number)
                putExtra(EXTRA_TAG, tag)
                putExtra(EXTRA_HISTORY, history)
                putExtra(EXTRA_IS_SPAM, isSpam)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun dismissIncomingCallCard(context: Context) {
            val intent = Intent(context, VoiceOverlayService::class.java).apply {
                action = ACTION_DISMISS_CALL_CARD
            }
            try {
                context.startService(intent)
            } catch (_: Exception) {
            }
        }

        fun syncVoiceControls(context: Context, settings: OwnerSettings) {
            val intent = Intent(context, VoiceOverlayService::class.java).apply {
                action = ACTION_SYNC_VOICE_CONTROLS
            }
            val wantsService = settings.floatingMicEnabled || settings.wakeWordEnabled
            try {
                if (wantsService) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(intent)
                    } else {
                        context.startService(intent)
                    }
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
            }
        }
    }
}
