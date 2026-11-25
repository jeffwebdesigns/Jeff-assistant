package com.machine.voice.permissions

import android.Manifest
import android.app.AlarmManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.machine.voice.service.MachineNotificationListenerService

data class PermissionSnapshot(
    val postNotifications: Boolean = false,
    val notificationListener: Boolean = false,
    val phoneAndCalls: Boolean = false,
    val contacts: Boolean = false,
    val callLog: Boolean = false,
    val microphone: Boolean = false,
    val bluetoothConnect: Boolean = false,
    val overlay: Boolean = false,
    val exactAlarm: Boolean = false,
    val batteryUnrestricted: Boolean = false,
    val callScreeningRole: Boolean = false
) {
    val coreReadyCount: Int
        get() = listOf(
            postNotifications,
            notificationListener,
            phoneAndCalls,
            contacts,
            callLog,
            microphone,
            batteryUnrestricted
        ).count { it }

    val coreTotalCount: Int = 7

    val allCoreGranted: Boolean
        get() = coreReadyCount == coreTotalCount
}

object PermissionHelper {

    fun runtimePermissionsToRequest(): Array<String> {
        val perms = mutableListOf(
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.READ_CALL_LOG,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.ANSWER_PHONE_CALLS
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            perms.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        return perms.toTypedArray()
    }

    fun inspect(context: Context): PermissionSnapshot {
        val postNotifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            hasPerm(context, Manifest.permission.POST_NOTIFICATIONS)
        } else {
            true
        }

        val listenerComponent = ComponentName(context, MachineNotificationListenerService::class.java)
        val enabledListeners = NotificationManagerCompat.getEnabledListenerPackages(context)
        val flatEnabled = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners"
        ).orEmpty()
        val notificationListener = enabledListeners.contains(context.packageName) ||
            flatEnabled.contains(listenerComponent.flattenToString())

        val phoneAndCalls = hasPerm(context, Manifest.permission.READ_PHONE_STATE)
        val contacts = hasPerm(context, Manifest.permission.READ_CONTACTS)
        val callLog = hasPerm(context, Manifest.permission.READ_CALL_LOG)
        val microphone = hasPerm(context, Manifest.permission.RECORD_AUDIO)
        val bluetoothConnect = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            hasPerm(context, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            true
        }

        val overlay = Settings.canDrawOverlays(context)

        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val exactAlarm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager?.canScheduleExactAlarms() == true
        } else {
            true
        }

        val powerManager = context.getSystemService(PowerManager::class.java)
        val batteryUnrestricted = powerManager?.isIgnoringBatteryOptimizations(context.packageName) == true

        val roleManager = context.getSystemService(RoleManager::class.java)
        val callScreeningRole = roleManager?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true

        return PermissionSnapshot(
            postNotifications = postNotifications,
            notificationListener = notificationListener,
            phoneAndCalls = phoneAndCalls,
            contacts = contacts,
            callLog = callLog,
            microphone = microphone,
            bluetoothConnect = bluetoothConnect,
            overlay = overlay,
            exactAlarm = exactAlarm,
            batteryUnrestricted = batteryUnrestricted,
            callScreeningRole = callScreeningRole
        )
    }

    private fun hasPerm(context: Context, permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    fun openNotificationListenerSettings(context: Context) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        launchSafely(context, intent)
    }

    fun openOverlaySettings(context: Context) {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}")
        ).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        launchSafely(context, intent)
    }

    fun openExactAlarmSettings(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val intent = Intent(
                Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:${context.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            launchSafely(context, intent)
        }
    }

    fun openBatteryOptimizationSettings(context: Context) {
        val directIntent = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${context.packageName}")
        ).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (!launchSafely(context, directIntent)) {
            openAppDetailsSettings(context)
        }
    }

    fun openAppDetailsSettings(context: Context) {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:${context.packageName}")
        ).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        launchSafely(context, intent)
    }

    fun buildCallScreeningRoleIntent(context: Context): Intent? {
        val roleManager = context.getSystemService(RoleManager::class.java) ?: return null
        return if (roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) &&
            !roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
        ) {
            roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING)
        } else {
            null
        }
    }

    private fun launchSafely(context: Context, intent: Intent): Boolean {
        return try {
            context.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }
}
