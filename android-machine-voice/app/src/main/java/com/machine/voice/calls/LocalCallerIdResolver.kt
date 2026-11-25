package com.machine.voice.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CallLog
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.machine.voice.data.local.CallerTagDao
import com.machine.voice.data.local.CallerTagEntity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class CallerLookupResult(
    val rawNumber: String,
    val normalizedNumber: String,
    val displayNumber: String,
    val contactName: String?,
    val customTag: String?,
    val isSpam: Boolean,
    val previousCallCount: Int,
    val lastCallSummary: String
)

data class DeviceCallLogEntry(
    val id: String,
    val rawNumber: String,
    val normalizedNumber: String,
    val contactName: String?,
    val callTypeLabel: String,
    val timestamp: Long,
    val formattedTime: String,
    val tagLabel: String?,
    val isSpam: Boolean
)

object LocalCallerIdResolver {

    fun normalizeNumber(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return ""
        val digitsOnly = trimmed.filter { it.isDigit() }
        if (digitsOnly.isEmpty()) return trimmed.uppercase(Locale.US)
        // Match Kenyan 07xx / +2547xx / 2541xx reliably via trailing 9 digits when standard phone length
        return if (digitsOnly.length >= 9) {
            digitsOnly.takeLast(9)
        } else {
            digitsOnly
        }
    }

    fun formatDigitsForSpeech(rawNumber: String): String {
        val cleaned = rawNumber.trim()
        if (cleaned.isEmpty()) return "private number"
        return cleaned.map { ch ->
            when (ch) {
                '+' -> "plus"
                in '0'..'9' -> ch.toString()
                else -> ""
            }
        }.filter { it.isNotEmpty() }.joinToString(" ")
    }

    suspend fun resolveIncomingCaller(
        context: Context,
        rawNumber: String,
        callerTagDao: CallerTagDao
    ): CallerLookupResult {
        val displayNumber = rawNumber.trim().ifEmpty { "Private Number" }
        val normalized = normalizeNumber(displayNumber)

        val contactName = if (normalized.isNotEmpty()) {
            lookupContactName(context, displayNumber)
        } else {
            null
        }

        val tagEntity: CallerTagEntity? = if (normalized.isNotEmpty()) {
            callerTagDao.findByNumber(normalized)
        } else {
            null
        }

        val (prevCount, lastSummary) = if (normalized.isNotEmpty()) {
            lookupCallHistorySummary(context, normalized)
        } else {
            0 to "No local history available"
        }

        return CallerLookupResult(
            rawNumber = displayNumber,
            normalizedNumber = normalized,
            displayNumber = displayNumber,
            contactName = contactName,
            customTag = tagEntity?.tagLabel?.takeIf { it.isNotBlank() },
            isSpam = tagEntity?.isSpam == true,
            previousCallCount = prevCount,
            lastCallSummary = lastSummary
        )
    }

    fun lookupContactName(context: Context, number: String): String? {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return null
        }
        return try {
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(number)
            )
            context.contentResolver.query(
                uri,
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
                null,
                null,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    cursor.getString(0)?.takeIf { it.isNotBlank() }
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun lookupCallHistorySummary(context: Context, normalizedTarget: String): Pair<Int, String> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return 0 to "Call log permission not granted"
        }
        var count = 0
        var latestSummary = "First recorded call"
        val dateFmt = SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault())

        try {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE),
                null,
                null,
                "${CallLog.Calls.DATE} DESC"
            )?.use { cursor ->
                val numIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER)
                val typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE)
                val dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE)
                var scanned = 0
                while (cursor.moveToNext() && scanned < 250) {
                    scanned += 1
                    val num = cursor.getString(numIdx).orEmpty()
                    if (normalizeNumber(num) == normalizedTarget) {
                        count += 1
                        if (count == 1) {
                            val typeLabel = mapCallType(cursor.getInt(typeIdx))
                            val dt = cursor.getLong(dateIdx)
                            latestSummary = "Last: $typeLabel (${dateFmt.format(Date(dt))})"
                        }
                    }
                }
            }
        } catch (_: Exception) {
            return 0 to "Unable to read local call history"
        }

        val finalSummary = if (count > 0) {
            "$count prior call${if (count == 1) "" else "s"} · $latestSummary"
        } else {
            "First call on this device"
        }
        return count to finalSummary
    }

    suspend fun fetchRecentCallLog(
        context: Context,
        callerTagDao: CallerTagDao,
        tagsByNormalized: Map<String, CallerTagEntity>,
        limit: Int = 40
    ): List<DeviceCallLogEntry> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return emptyList()
        }

        val entries = mutableListOf<DeviceCallLogEntry>()
        val dateFmt = SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault())

        try {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(
                    CallLog.Calls._ID,
                    CallLog.Calls.NUMBER,
                    CallLog.Calls.CACHED_NAME,
                    CallLog.Calls.TYPE,
                    CallLog.Calls.DATE
                ),
                null,
                null,
                "${CallLog.Calls.DATE} DESC"
            )?.use { cursor ->
                val idIdx = cursor.getColumnIndex(CallLog.Calls._ID)
                val numIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER)
                val nameIdx = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE)
                val dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE)

                while (cursor.moveToNext() && entries.size < limit) {
                    val id = cursor.getString(idIdx) ?: entries.size.toString()
                    val rawNum = cursor.getString(numIdx).orEmpty().trim()
                    if (rawNum.isEmpty()) continue
                    val normalized = normalizeNumber(rawNum)
                    val cachedName = cursor.getString(nameIdx)?.takeIf { it.isNotBlank() }
                        ?: lookupContactName(context, rawNum)
                    val tag = tagsByNormalized[normalized] ?: callerTagDao.findByNumber(normalized)
                    val timestamp = cursor.getLong(dateIdx)

                    entries.add(
                        DeviceCallLogEntry(
                            id = id,
                            rawNumber = rawNum,
                            normalizedNumber = normalized,
                            contactName = cachedName,
                            callTypeLabel = mapCallType(cursor.getInt(typeIdx)),
                            timestamp = timestamp,
                            formattedTime = dateFmt.format(Date(timestamp)),
                            tagLabel = tag?.tagLabel?.takeIf { it.isNotBlank() },
                            isSpam = tag?.isSpam == true
                        )
                    )
                }
            }
        } catch (_: Exception) {
            return emptyList()
        }
        return entries
    }

    private fun mapCallType(type: Int): String = when (type) {
        CallLog.Calls.INCOMING_TYPE -> "Incoming"
        CallLog.Calls.OUTGOING_TYPE -> "Outgoing"
        CallLog.Calls.MISSED_TYPE -> "Missed"
        CallLog.Calls.REJECTED_TYPE -> "Rejected"
        CallLog.Calls.BLOCKED_TYPE -> "Blocked"
        else -> "Call"
    }
}
