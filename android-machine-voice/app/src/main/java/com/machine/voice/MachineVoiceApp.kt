package com.machine.voice

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class MachineVoiceApp : Application() {

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        val manager = getSystemService(NotificationManager::class.java) ?: return

        val keepAliveChannel = NotificationChannel(
            CHANNEL_KEEP_ALIVE,
            "Machine Voice Active Service",
            NotificationManager.IMPORTANCE_MIN
        ).apply {
            description = "Keeps notification reader, caller announcer, and local reminders reliable on Samsung devices."
            setShowBadge(false)
        }

        val reminderChannel = NotificationChannel(
            CHANNEL_REMINDERS,
            "Reminders & Briefings",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Spoken reminders, meeting alerts, and morning briefings."
        }

        val quickReplyChannel = NotificationChannel(
            CHANNEL_QUICK_REPLY,
            "Voice Quick Actions",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Notifications used to review and confirm actions."
        }

        manager.createNotificationChannels(
            listOf(keepAliveChannel, reminderChannel, quickReplyChannel)
        )
    }

    companion object {
        const val CHANNEL_KEEP_ALIVE = "channel_keep_alive"
        const val CHANNEL_REMINDERS = "channel_reminders"
        const val CHANNEL_QUICK_REPLY = "channel_quick_reply"
    }
}
