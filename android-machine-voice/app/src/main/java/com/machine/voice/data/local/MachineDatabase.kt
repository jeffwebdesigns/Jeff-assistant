package com.machine.voice.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        NotificationLogEntity::class,
        AppRuleEntity::class,
        ContactRuleEntity::class,
        CallerTagEntity::class,
        ReminderEntity::class
    ],
    version = 3,
    exportSchema = false
)
abstract class MachineDatabase : RoomDatabase() {
    abstract fun notificationLogDao(): NotificationLogDao
    abstract fun appRuleDao(): AppRuleDao
    abstract fun contactRuleDao(): ContactRuleDao
    abstract fun callerTagDao(): CallerTagDao
    abstract fun reminderDao(): ReminderDao

    suspend fun ensureDefaultAppRulesSeeded() {
        appRuleDao().insertMissing(DEFAULT_APP_RULES)
    }

    companion object {
        @Volatile
        private var INSTANCE: MachineDatabase? = null

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `caller_tags` (
                        `normalizedNumber` TEXT NOT NULL,
                        `displayNumber` TEXT NOT NULL,
                        `tagLabel` TEXT NOT NULL,
                        `isSpam` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`normalizedNumber`)
                    )
                    """.trimIndent()
                )
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `reminders` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `title` TEXT NOT NULL,
                        `triggerAtMillis` INTEGER NOT NULL,
                        `isMeeting` INTEGER NOT NULL,
                        `completed` INTEGER NOT NULL,
                        `notes` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
            }
        }

        fun getInstance(context: Context): MachineDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    MachineDatabase::class.java,
                    "machine_voice.db"
                )
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                    .build()
                    .also { INSTANCE = it }
            }
        }

        val DEFAULT_APP_RULES = listOf(
            AppRuleEntity("com.whatsapp", "WhatsApp", "Messaging", true),
            AppRuleEntity("com.whatsapp.w4b", "WhatsApp Business", "Messaging", true),
            AppRuleEntity("com.google.android.apps.messaging", "Google Messages (SMS)", "Messaging", true),
            AppRuleEntity("com.samsung.android.messaging", "Samsung Messages (SMS)", "Messaging", true),
            AppRuleEntity("com.google.android.gm", "Gmail", "Email", true),
            AppRuleEntity("com.safaricom.android.mpesa", "M-Pesa", "Finance", true),
            AppRuleEntity("ke.co.equitygroup.equitymobile", "Equity Mobile", "Finance", true),
            AppRuleEntity("com.kcbgroup.kcb", "KCB Mobile", "Finance", true),
            AppRuleEntity("com.instagram.android", "Instagram", "Social", false),
            AppRuleEntity("com.facebook.katana", "Facebook", "Social", false),
            AppRuleEntity("com.facebook.orca", "Messenger", "Messaging", true),
            AppRuleEntity("com.zhiliaoapp.musically", "TikTok", "Social", false)
        )
    }
}
