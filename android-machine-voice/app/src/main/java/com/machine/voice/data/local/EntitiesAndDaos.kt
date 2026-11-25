package com.machine.voice.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "notification_logs")
data class NotificationLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sbnKey: String,
    val packageName: String,
    val appName: String,
    val sender: String,
    val previewText: String,
    val fullText: String,
    val languageCode: String,
    val isGroup: Boolean,
    val isSensitiveShielded: Boolean,
    val isVip: Boolean,
    val spokenAloud: Boolean,
    val receivedAt: Long
)

@Entity(tableName = "app_rules")
data class AppRuleEntity(
    @PrimaryKey val packageName: String,
    val appLabel: String,
    val category: String,
    val enabled: Boolean
)

enum class ContactPriority {
    VIP,
    NORMAL,
    SILENT
}

@Entity(tableName = "contact_rules")
data class ContactRuleEntity(
    @PrimaryKey val senderKey: String,
    val displayName: String,
    val priority: String
)

@Dao
interface NotificationLogDao {
    @Query("SELECT * FROM notification_logs ORDER BY receivedAt DESC LIMIT :limit")
    fun observeRecent(limit: Int = 100): Flow<List<NotificationLogEntity>>

    @Query("SELECT * FROM notification_logs ORDER BY receivedAt DESC LIMIT :limit")
    suspend fun listRecent(limit: Int = 50): List<NotificationLogEntity>

    @Query("SELECT * FROM notification_logs WHERE LOWER(sender) LIKE '%' || LOWER(:query) || '%' ORDER BY receivedAt DESC LIMIT 20")
    suspend fun findBySender(query: String): List<NotificationLogEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: NotificationLogEntity): Long

    @Query("DELETE FROM notification_logs WHERE receivedAt < :cutoffEpochMillis")
    suspend fun deleteOlderThan(cutoffEpochMillis: Long)

    @Query("DELETE FROM notification_logs")
    suspend fun deleteAll()
}

@Dao
interface AppRuleDao {
    @Query("SELECT * FROM app_rules ORDER BY category ASC, appLabel ASC")
    fun observeAll(): Flow<List<AppRuleEntity>>

    @Query("SELECT * FROM app_rules ORDER BY category ASC, appLabel ASC")
    suspend fun listAll(): List<AppRuleEntity>

    @Query("SELECT * FROM app_rules WHERE packageName = :packageName LIMIT 1")
    suspend fun findByPackage(packageName: String): AppRuleEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rule: AppRuleEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertMissing(rules: List<AppRuleEntity>)

    @Query("UPDATE app_rules SET enabled = :enabled WHERE packageName = :packageName")
    suspend fun setEnabled(packageName: String, enabled: Boolean)

    @Query("DELETE FROM app_rules")
    suspend fun deleteAll()
}

@Dao
interface ContactRuleDao {
    @Query("SELECT * FROM contact_rules ORDER BY priority ASC, displayName ASC")
    fun observeAll(): Flow<List<ContactRuleEntity>>

    @Query("SELECT * FROM contact_rules ORDER BY priority ASC, displayName ASC")
    suspend fun listAll(): List<ContactRuleEntity>

    @Query("SELECT * FROM contact_rules WHERE senderKey = :senderKey LIMIT 1")
    suspend fun findByKey(senderKey: String): ContactRuleEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rule: ContactRuleEntity)

    @Query("DELETE FROM contact_rules WHERE senderKey = :senderKey")
    suspend fun deleteByKey(senderKey: String)

    @Query("DELETE FROM contact_rules")
    suspend fun deleteAll()
}

@Entity(tableName = "caller_tags")
data class CallerTagEntity(
    @PrimaryKey val normalizedNumber: String,
    val displayNumber: String,
    val tagLabel: String,
    val isSpam: Boolean,
    val updatedAt: Long
)

@Dao
interface CallerTagDao {
    @Query("SELECT * FROM caller_tags ORDER BY isSpam DESC, updatedAt DESC")
    fun observeAll(): Flow<List<CallerTagEntity>>

    @Query("SELECT * FROM caller_tags ORDER BY isSpam DESC, updatedAt DESC")
    suspend fun listAll(): List<CallerTagEntity>

    @Query("SELECT * FROM caller_tags WHERE normalizedNumber = :normalizedNumber LIMIT 1")
    suspend fun findByNumber(normalizedNumber: String): CallerTagEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(item: CallerTagEntity)

    @Query("DELETE FROM caller_tags WHERE normalizedNumber = :normalizedNumber")
    suspend fun deleteByNumber(normalizedNumber: String)

    @Query("DELETE FROM caller_tags")
    suspend fun deleteAll()
}

@Entity(tableName = "reminders")
data class ReminderEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val triggerAtMillis: Long,
    val isMeeting: Boolean,
    val completed: Boolean = false,
    val notes: String = "",
    val createdAt: Long = System.currentTimeMillis()
)

@Dao
interface ReminderDao {
    @Query("SELECT * FROM reminders ORDER BY completed ASC, triggerAtMillis ASC")
    fun observeAll(): Flow<List<ReminderEntity>>

    @Query("SELECT * FROM reminders ORDER BY completed ASC, triggerAtMillis ASC")
    suspend fun listAll(): List<ReminderEntity>

    @Query("SELECT * FROM reminders WHERE completed = 0 ORDER BY triggerAtMillis ASC")
    suspend fun listActive(): List<ReminderEntity>

    @Query("SELECT * FROM reminders WHERE id = :id LIMIT 1")
    suspend fun findById(id: Long): ReminderEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(reminder: ReminderEntity): Long

    @Query("UPDATE reminders SET completed = :completed WHERE id = :id")
    suspend fun setCompleted(id: Long, completed: Boolean)

    @Query("DELETE FROM reminders WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("DELETE FROM reminders")
    suspend fun deleteAll()
}
