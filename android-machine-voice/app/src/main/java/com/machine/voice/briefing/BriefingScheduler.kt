package com.machine.voice.briefing

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.machine.voice.MachineVoiceApp
import com.machine.voice.MainActivity
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.SecurePrefs
import com.machine.voice.speech.SpeechQueueManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

object BriefingScheduler {

    private const val REQUEST_CODE_BRIEFING = 7701
    private const val NOTIFICATION_ID_BRIEFING = 7702
    const val ACTION_DAILY_BRIEFING = "com.machine.voice.ACTION_DAILY_BRIEFING"
    const val ACTION_PLAY_BRIEFING = "com.machine.voice.ACTION_PLAY_BRIEFING"

    fun scheduleNextDailyBriefing(context: Context) {
        val appContext = context.applicationContext
        val settings = SecurePrefs(appContext).settings.value
        cancelDailyBriefing(appContext)
        if (!settings.onboardingCompleted || !settings.morningBriefingEnabled) {
            return
        }

        val targetTime = parseTimeOrDefault(settings.morningBriefingTime)
        val now = LocalDateTime.now()
        var nextTrigger = LocalDateTime.of(now.toLocalDate(), targetTime)
        if (!nextTrigger.isAfter(now.plusSeconds(30))) {
            nextTrigger = nextTrigger.plusDays(1)
        }
        val triggerMillis = nextTrigger.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

        val alarmManager = appContext.getSystemService(AlarmManager::class.java) ?: return
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            alarmManager.canScheduleExactAlarms()

        val pi = buildBriefingPendingIntent(appContext)
        try {
            if (canExact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMillis, pi)
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMillis, pi)
            }
        } catch (_: SecurityException) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMillis, pi)
        }
    }

    fun cancelDailyBriefing(context: Context) {
        val appContext = context.applicationContext
        val alarmManager = appContext.getSystemService(AlarmManager::class.java) ?: return
        val intent = Intent(appContext, BriefingAlarmReceiver::class.java).apply {
            action = ACTION_DAILY_BRIEFING
        }
        val existing = PendingIntent.getBroadcast(
            appContext,
            REQUEST_CODE_BRIEFING,
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (existing != null) {
            alarmManager.cancel(existing)
            existing.cancel()
        }
    }

    suspend fun deliverBriefingNotificationAndOptionalSpeech(
        context: Context,
        speakNow: Boolean
    ) {
        val appContext = context.applicationContext
        val prefs = SecurePrefs(appContext)
        val settings = prefs.settings.value
        val report = BriefingGenerator.generate(appContext, allowCloudPolish = true)

        postMorningNotification(appContext, report, settings.language)

        if (speakNow) {
            val speechQueue = SpeechQueueManager.getInstance(appContext)
            if (!settings.headphoneOnlyMode || speechQueue.areHeadphonesOrBluetoothConnected()) {
                prefs.setLastBriefingSpokenDate(LocalDate.now().toString())
                speechQueue.enqueue(
                    text = report.spokenScript,
                    language = settings.language,
                    pauseDuringCall = true
                )
            }
        }
    }

    suspend fun maybeSpeakOnFirstMorningUnlock(context: Context) {
        val appContext = context.applicationContext
        val prefs = SecurePrefs(appContext)
        val settings = prefs.settings.value
        if (!settings.onboardingCompleted || !settings.speakBriefingOnUnlock) return

        val today = LocalDate.now().toString()
        if (settings.lastBriefingSpokenDate == today) return

        val scheduledTime = parseTimeOrDefault(settings.morningBriefingTime)
        if (LocalTime.now().isBefore(scheduledTime)) return

        val speechQueue = SpeechQueueManager.getInstance(appContext)
        if (settings.headphoneOnlyMode && !speechQueue.areHeadphonesOrBluetoothConnected()) return
        if (speechQueue.isInActiveCall()) return

        prefs.setLastBriefingSpokenDate(today)
        val report = BriefingGenerator.generate(appContext, allowCloudPolish = true)
        speechQueue.enqueue(
            text = report.spokenScript,
            language = settings.language,
            pauseDuringCall = true
        )
    }

    private fun postMorningNotification(
        context: Context,
        report: BriefingReport,
        lang: AppLanguage
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val openIntent = Intent(context, MainActivity::class.java).apply {
            action = MainActivity.ACTION_OPEN_ROUTE
            putExtra(MainActivity.EXTRA_OPEN_ROUTE, "briefing")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val openPending = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID_BRIEFING,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playIntent = Intent(context, BriefingAlarmReceiver::class.java).apply {
            action = ACTION_PLAY_BRIEFING
        }
        val playPending = PendingIntent.getBroadcast(
            context,
            NOTIFICATION_ID_BRIEFING + 1,
            playIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = if (lang == AppLanguage.SWAHILI) "Muhtasari wa Asubuhi · Machine" else "Morning Briefing · Machine"
        val notification = NotificationCompat.Builder(context, MachineVoiceApp.CHANNEL_REMINDERS)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(title)
            .setContentText(report.headline)
            .setStyle(NotificationCompat.BigTextStyle().bigText("${report.headline}\n\n${report.spokenScript}"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openPending)
            .addAction(0, if (lang == AppLanguage.SWAHILI) "Soma Kwa Sauti" else "Play Voice", playPending)
            .build()

        context.getSystemService(NotificationManager::class.java)
            ?.notify(NOTIFICATION_ID_BRIEFING, notification)
    }

    private fun buildBriefingPendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, BriefingAlarmReceiver::class.java).apply {
            action = ACTION_DAILY_BRIEFING
        }
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE_BRIEFING,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    fun parseTimeOrDefault(value: String): LocalTime {
        return try {
            LocalTime.parse(value.trim())
        } catch (_: Exception) {
            LocalTime.of(7, 30)
        }
    }
}

class BriefingAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val appContext = context.applicationContext
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    BriefingScheduler.ACTION_PLAY_BRIEFING -> {
                        val settings = SecurePrefs(appContext).settings.value
                        val report = BriefingGenerator.generate(appContext, allowCloudPolish = true)
                        SpeechQueueManager.getInstance(appContext).enqueue(
                            text = report.spokenScript,
                            language = settings.language,
                            pauseDuringCall = false
                        )
                    }

                    BriefingScheduler.ACTION_DAILY_BRIEFING -> {
                        val settings = SecurePrefs(appContext).settings.value
                        BriefingScheduler.deliverBriefingNotificationAndOptionalSpeech(
                            context = appContext,
                            speakNow = !settings.speakBriefingOnUnlock
                        )
                        BriefingScheduler.scheduleNextDailyBriefing(appContext)
                    }
                }
            } finally {
                pending.finish()
            }
        }
    }
}
