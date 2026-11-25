package com.machine.voice.service

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
import com.machine.voice.data.local.MachineDatabase
import com.machine.voice.data.prefs.SecurePrefs
import com.machine.voice.reminders.ReminderOffset
import com.machine.voice.reminders.ReminderScheduler
import com.machine.voice.speech.SpeechQueueManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Triggers spoken reminder alerts & high-priority notifications at 1d, 1h, 10m, and due time,
 * plus direct notification "Mark Done" quick action.
 */
class ReminderAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val appContext = context.applicationContext
        val reminderId = intent.getLongExtra(ReminderScheduler.EXTRA_REMINDER_ID, -1L)
        if (reminderId <= 0L) return

        if (intent.action == ACTION_MARK_DONE) {
            val pending = goAsync()
            CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                try {
                    MachineDatabase.getInstance(appContext).reminderDao().setCompleted(reminderId, true)
                    ReminderScheduler.cancelReminder(appContext, reminderId)
                    val nm = appContext.getSystemService(NotificationManager::class.java)
                    nm?.cancel(notificationIdFor(reminderId))
                } finally {
                    pending.finish()
                }
            }
            return
        }

        val offsetCode = intent.getStringExtra(ReminderScheduler.EXTRA_OFFSET_CODE)
        val offset = ReminderOffset.fromCode(offsetCode)
        val fallbackTitle = intent.getStringExtra(ReminderScheduler.EXTRA_REMINDER_TITLE).orEmpty()
        val fallbackMeeting = intent.getBooleanExtra(ReminderScheduler.EXTRA_IS_MEETING, false)

        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val db = MachineDatabase.getInstance(appContext)
                val entity = db.reminderDao().findById(reminderId)
                if (entity != null && entity.completed) {
                    return@launch
                }

                val title = entity?.title?.takeIf { it.isNotBlank() } ?: fallbackTitle.ifBlank { "Reminder" }
                val isMeeting = entity?.isMeeting ?: fallbackMeeting
                val settings = SecurePrefs(appContext).settings.value
                val lang = settings.language

                postReminderNotification(
                    context = appContext,
                    reminderId = reminderId,
                    title = title,
                    subtitle = offset.notificationSubtitle(lang),
                    isMeeting = isMeeting
                )

                val speechQueue = SpeechQueueManager.getInstance(appContext)
                if (!settings.headphoneOnlyMode || speechQueue.areHeadphonesOrBluetoothConnected()) {
                    speechQueue.enqueue(
                        text = offset.spokenLead(isMeeting = isMeeting, title = title, lang = lang),
                        language = lang,
                        pauseDuringCall = true
                    )
                }
            } finally {
                pending.finish()
            }
        }
    }

    private fun postReminderNotification(
        context: Context,
        reminderId: Long,
        title: String,
        subtitle: String,
        isMeeting: Boolean
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val openIntent = Intent(context, MainActivity::class.java).apply {
            action = MainActivity.ACTION_OPEN_ROUTE
            putExtra(MainActivity.EXTRA_OPEN_ROUTE, "reminders")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val openPending = PendingIntent.getActivity(
            context,
            notificationIdFor(reminderId),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val doneIntent = Intent(context, ReminderAlarmReceiver::class.java).apply {
            action = ACTION_MARK_DONE
            putExtra(ReminderScheduler.EXTRA_REMINDER_ID, reminderId)
        }
        val donePending = PendingIntent.getBroadcast(
            context,
            notificationIdFor(reminderId) + 5000,
            doneIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val label = if (isMeeting) "MEETING ALERT" else "REMINDER ALERT"
        val notification = NotificationCompat.Builder(context, MachineVoiceApp.CHANNEL_REMINDERS)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("$label · $subtitle")
            .setContentText(title)
            .setStyle(NotificationCompat.BigTextStyle().bigText(title))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openPending)
            .addAction(0, "Mark Done", donePending)
            .build()

        context.getSystemService(NotificationManager::class.java)
            ?.notify(notificationIdFor(reminderId), notification)
    }

    private fun notificationIdFor(reminderId: Long): Int {
        return 30_000 + (reminderId % 10_000L).toInt()
    }

    companion object {
        const val ACTION_MARK_DONE = "com.machine.voice.ACTION_REMINDER_MARK_DONE"
    }
}

/**
 * Restores keep-alive foreground services, floating voice controls, and active AlarmManager
 * reminders after device reboot, package update, or exact alarm permission changes.
 */
class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED
        ) {
            val appContext = context.applicationContext
            val prefs = SecurePrefs(appContext)
            val snapshot = prefs.settings.value
            if (snapshot.onboardingCompleted && snapshot.keepAliveEnabled) {
                MachineKeepAliveService.start(appContext)
            }
            if (snapshot.onboardingCompleted &&
                (snapshot.floatingMicEnabled || snapshot.wakeWordEnabled)
            ) {
                VoiceOverlayService.syncVoiceControls(appContext, snapshot)
            }

            val pending = goAsync()
            CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                try {
                    val active = MachineDatabase.getInstance(appContext).reminderDao().listActive()
                    ReminderScheduler.rescheduleAllActive(appContext, active)
                    com.machine.voice.briefing.BriefingScheduler.scheduleNextDailyBriefing(appContext)
                } finally {
                    pending.finish()
                }
            }
        }
    }
}
