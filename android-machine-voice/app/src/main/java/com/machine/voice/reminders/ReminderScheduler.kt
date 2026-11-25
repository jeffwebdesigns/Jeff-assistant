package com.machine.voice.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.CalendarContract
import com.machine.voice.data.local.ReminderEntity
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.service.ReminderAlarmReceiver

enum class ReminderOffset(
    val code: String,
    val offsetMillis: Long,
    val salt: Int
) {
    ONE_DAY("1d", 86_400_000L, 1),
    ONE_HOUR("1h", 3_600_000L, 2),
    TEN_MINUTES("10m", 600_000L, 3),
    AT_START("start", 0L, 4);

    fun spokenLead(isMeeting: Boolean, title: String, lang: AppLanguage): String {
        val kindEn = if (isMeeting) "Meeting" else "Reminder"
        val kindSw = if (isMeeting) "Mkutano" else "Kikumbusho"
        return when (this) {
            ONE_DAY -> if (lang == AppLanguage.SWAHILI) {
                "$kindSw kesho: $title."
            } else {
                "$kindEn tomorrow: $title."
            }

            ONE_HOUR -> if (lang == AppLanguage.SWAHILI) {
                "$kindSw baada ya saa moja: $title."
            } else {
                "$kindEn in 1 hour: $title."
            }

            TEN_MINUTES -> if (lang == AppLanguage.SWAHILI) {
                "$kindSw baada ya dakika kumi: $title."
            } else {
                "$kindEn in 10 minutes: $title."
            }

            AT_START -> if (lang == AppLanguage.SWAHILI) {
                "$kindSw sasa: $title."
            } else {
                "$kindEn now: $title."
            }
        }
    }

    fun notificationSubtitle(lang: AppLanguage): String = when (this) {
        ONE_DAY -> if (lang == AppLanguage.SWAHILI) "Baada ya siku 1" else "In 1 day"
        ONE_HOUR -> if (lang == AppLanguage.SWAHILI) "Baada ya saa 1" else "In 1 hour"
        TEN_MINUTES -> if (lang == AppLanguage.SWAHILI) "Baada ya dakika 10" else "In 10 minutes"
        AT_START -> if (lang == AppLanguage.SWAHILI) "Wakati umefika" else "Starting now"
    }

    companion object {
        fun fromCode(code: String?): ReminderOffset {
            return entries.firstOrNull { it.code == code } ?: AT_START
        }
    }
}

object ReminderScheduler {

    const val EXTRA_REMINDER_ID = "extra_reminder_id"
    const val EXTRA_REMINDER_TITLE = "extra_reminder_title"
    const val EXTRA_OFFSET_CODE = "extra_offset_code"
    const val EXTRA_IS_MEETING = "extra_is_meeting"

    fun scheduleReminder(context: Context, reminder: ReminderEntity) {
        cancelReminder(context, reminder.id)
        if (reminder.completed || reminder.id <= 0L) return

        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
        val now = System.currentTimeMillis()
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            alarmManager.canScheduleExactAlarms()

        ReminderOffset.entries.forEach { offset ->
            val fireAt = reminder.triggerAtMillis - offset.offsetMillis
            if (fireAt <= now + 2_000L) return@forEach

            val pi = buildAlarmPendingIntent(
                context = context,
                reminder = reminder,
                offset = offset,
                flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            try {
                if (canExact) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
                } else {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
                }
            } catch (_: SecurityException) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
            }
        }
    }

    fun cancelReminder(context: Context, reminderId: Long) {
        if (reminderId <= 0L) return
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
        ReminderOffset.entries.forEach { offset ->
            val intent = Intent(context, ReminderAlarmReceiver::class.java).apply {
                action = "com.machine.voice.REMINDER_ALARM_${reminderId}_${offset.code}"
            }
            val requestCode = requestCodeFor(reminderId, offset)
            val existing = PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (existing != null) {
                alarmManager.cancel(existing)
                existing.cancel()
            }
        }
    }

    fun rescheduleAllActive(context: Context, reminders: List<ReminderEntity>) {
        reminders.filter { !it.completed }.forEach { scheduleReminder(context, it) }
    }

    fun buildCalendarInsertIntent(reminder: ReminderEntity): Intent {
        val durationMs = if (reminder.isMeeting) 3_600_000L else 1_800_000L
        return Intent(Intent.ACTION_INSERT).apply {
            data = CalendarContract.Events.CONTENT_URI
            putExtra(CalendarContract.Events.TITLE, reminder.title)
            putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, reminder.triggerAtMillis)
            putExtra(CalendarContract.EXTRA_EVENT_END_TIME, reminder.triggerAtMillis + durationMs)
            putExtra(
                CalendarContract.Events.DESCRIPTION,
                reminder.notes.ifBlank { "Created by Machine Voice" }
            )
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }

    private fun buildAlarmPendingIntent(
        context: Context,
        reminder: ReminderEntity,
        offset: ReminderOffset,
        flags: Int
    ): PendingIntent {
        val intent = Intent(context, ReminderAlarmReceiver::class.java).apply {
            action = "com.machine.voice.REMINDER_ALARM_${reminder.id}_${offset.code}"
            putExtra(EXTRA_REMINDER_ID, reminder.id)
            putExtra(EXTRA_REMINDER_TITLE, reminder.title)
            putExtra(EXTRA_OFFSET_CODE, offset.code)
            putExtra(EXTRA_IS_MEETING, reminder.isMeeting)
        }
        return PendingIntent.getBroadcast(
            context,
            requestCodeFor(reminder.id, offset),
            intent,
            flags
        )
    }

    private fun requestCodeFor(reminderId: Long, offset: ReminderOffset): Int {
        return ((reminderId % 100_000L).toInt() * 10) + offset.salt
    }
}
