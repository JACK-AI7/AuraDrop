package com.auradrop.auradrop

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class AuraDropDatabaseHelper(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        const val DATABASE_NAME = "auradrop.db"
        const val DATABASE_VERSION = 1

        // Table Transfers
        const val TABLE_TRANSFERS = "transfers"
        const val COL_XFER_ID = "id"
        const val COL_XFER_TIMESTAMP = "timestamp"
        const val COL_XFER_SENDER = "sender_name"
        const val COL_XFER_RECEIVER = "receiver_name"
        const val COL_XFER_FILE_NAME = "file_name"
        const val COL_XFER_FILE_TYPE = "file_type"
        const val COL_XFER_FILE_SIZE = "file_size"
        const val COL_XFER_DIRECTION = "direction" // "sent" or "received"
        const val COL_XFER_STATUS = "status"       // "completed", "failed", "cancelled"
        const val COL_XFER_DURATION = "duration_ms"
        const val COL_XFER_AVG_SPEED = "avg_speed"
        const val COL_XFER_SHA256 = "sha256"
        const val COL_XFER_LOCAL_PATH = "local_path"
        const val COL_XFER_TRANSPORT = "transport_type"

        // Table Chat Messages
        const val TABLE_CHATS = "chat_messages"
        const val COL_CHAT_ID = "id"
        const val COL_CHAT_PEER_ID = "peer_id"
        const val COL_CHAT_PEER_NAME = "peer_name"
        const val COL_CHAT_SENDER_ID = "sender_id"
        const val COL_CHAT_TEXT = "message_text"
        const val COL_CHAT_TIMESTAMP = "timestamp"
        const val COL_CHAT_STATUS = "status" // "sending", "sent", "delivered", "read"

        // Table User Profile
        const val TABLE_PROFILE = "user_profile"
        const val COL_PROF_KEY = "key"
        const val COL_PROF_VAL = "value"

        // Table Trusted Peers
        const val TABLE_TRUSTED = "trusted_peers"
        const val COL_TRUST_PEER_ID = "peer_id"
        const val COL_TRUST_PEER_NAME = "peer_name"
        const val COL_TRUST_TIMESTAMP = "trusted_since"

        // Table Blocked Peers
        const val TABLE_BLOCKED = "blocked_peers"
        const val COL_BLOCK_PEER_ID = "peer_id"
        const val COL_BLOCK_PEER_NAME = "peer_name"
        const val COL_BLOCK_TIMESTAMP = "blocked_since"

        // Table Incoming Share Requests (Section 16)
        const val TABLE_INCOMING_REQUESTS = "incoming_requests"
        const val COL_REQ_ID = "request_id"
        const val COL_REQ_SESSION_ID = "transfer_session_id"
        const val COL_REQ_SENDER_DEVICE_ID = "sender_device_id"
        const val COL_REQ_SENDER_DISPLAY_NAME = "sender_display_name"
        const val COL_REQ_SENDER_DEVICE_NAME = "sender_device_name"
        const val COL_REQ_FILE_COUNT = "file_count"
        const val COL_REQ_FILE_MANIFEST = "file_manifest"
        const val COL_REQ_TOTAL_BYTES = "total_bytes"
        const val COL_REQ_CREATED_AT = "created_at"
        const val COL_REQ_EXPIRES_AT = "expires_at"
        const val COL_REQ_STATUS = "status"
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS $TABLE_TRANSFERS (
                $COL_XFER_ID TEXT PRIMARY KEY,
                $COL_XFER_TIMESTAMP INTEGER NOT NULL,
                $COL_XFER_SENDER TEXT NOT NULL,
                $COL_XFER_RECEIVER TEXT NOT NULL,
                $COL_XFER_FILE_NAME TEXT NOT NULL,
                $COL_XFER_FILE_TYPE TEXT,
                $COL_XFER_FILE_SIZE INTEGER NOT NULL,
                $COL_XFER_DIRECTION TEXT NOT NULL,
                $COL_XFER_STATUS TEXT NOT NULL,
                $COL_XFER_DURATION INTEGER,
                $COL_XFER_AVG_SPEED INTEGER,
                $COL_XFER_SHA256 TEXT,
                $COL_XFER_LOCAL_PATH TEXT,
                $COL_XFER_TRANSPORT TEXT
            )
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS $TABLE_CHATS (
                $COL_CHAT_ID TEXT PRIMARY KEY,
                $COL_CHAT_PEER_ID TEXT NOT NULL,
                $COL_CHAT_PEER_NAME TEXT NOT NULL,
                $COL_CHAT_SENDER_ID TEXT NOT NULL,
                $COL_CHAT_TEXT TEXT NOT NULL,
                $COL_CHAT_TIMESTAMP INTEGER NOT NULL,
                $COL_CHAT_STATUS TEXT NOT NULL
            )
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS $TABLE_PROFILE (
                $COL_PROF_KEY TEXT PRIMARY KEY,
                $COL_PROF_VAL TEXT
            )
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS $TABLE_TRUSTED (
                $COL_TRUST_PEER_ID TEXT PRIMARY KEY,
                $COL_TRUST_PEER_NAME TEXT NOT NULL,
                $COL_TRUST_TIMESTAMP INTEGER NOT NULL
            )
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS $TABLE_BLOCKED (
                $COL_BLOCK_PEER_ID TEXT PRIMARY KEY,
                $COL_BLOCK_PEER_NAME TEXT NOT NULL,
                $COL_BLOCK_TIMESTAMP INTEGER NOT NULL
            )
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS $TABLE_INCOMING_REQUESTS (
                $COL_REQ_ID TEXT PRIMARY KEY,
                $COL_REQ_SESSION_ID TEXT NOT NULL,
                $COL_REQ_SENDER_DEVICE_ID TEXT NOT NULL,
                $COL_REQ_SENDER_DISPLAY_NAME TEXT NOT NULL,
                $COL_REQ_SENDER_DEVICE_NAME TEXT NOT NULL,
                $COL_REQ_FILE_COUNT INTEGER NOT NULL,
                $COL_REQ_FILE_MANIFEST TEXT NOT NULL,
                $COL_REQ_TOTAL_BYTES INTEGER NOT NULL,
                $COL_REQ_CREATED_AT INTEGER NOT NULL,
                $COL_REQ_EXPIRES_AT INTEGER NOT NULL,
                $COL_REQ_STATUS TEXT NOT NULL
            )
        """.trimIndent())

        // Insert real hardware device name as default profile name
        val defaultDeviceModel = "${android.os.Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${android.os.Build.MODEL}"
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('display_name', '$defaultDeviceModel')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('device_name', '$defaultDeviceModel')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('avatar_index', '0')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('bio', 'Nearby sharing made effortless')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('theme', 'dark')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('accent', 'white')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('visibility', 'everyone')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('background_discovery', 'true')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('allow_nearby_requests', 'true')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('notification_preview', 'full')")
        db.execSQL("INSERT OR IGNORE INTO $TABLE_PROFILE VALUES ('reduced_motion', 'false')")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Upgrade safely preserving history
    }

    // -------------------------------------------------------------------------
    // TRANSFER METHODS
    // -------------------------------------------------------------------------
    fun insertTransfer(item: Map<String, Any>): Boolean {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put(COL_XFER_ID, item["id"]?.toString())
            put(COL_XFER_TIMESTAMP, (item["timestamp"] as? Number)?.toLong() ?: System.currentTimeMillis())
            put(COL_XFER_SENDER, item["senderName"]?.toString() ?: "Device")
            put(COL_XFER_RECEIVER, item["receiverName"]?.toString() ?: "Device")
            put(COL_XFER_FILE_NAME, item["fileName"]?.toString() ?: "file")
            put(COL_XFER_FILE_TYPE, item["fileType"]?.toString() ?: "application/octet-stream")
            put(COL_XFER_FILE_SIZE, (item["fileSize"] as? Number)?.toLong() ?: 0L)
            put(COL_XFER_DIRECTION, item["direction"]?.toString() ?: "received")
            put(COL_XFER_STATUS, item["status"]?.toString() ?: "completed")
            put(COL_XFER_DURATION, (item["durationMs"] as? Number)?.toLong() ?: 0L)
            put(COL_XFER_AVG_SPEED, (item["avgSpeed"] as? Number)?.toLong() ?: 0L)
            put(COL_XFER_SHA256, item["sha256"]?.toString() ?: "")
            put(COL_XFER_LOCAL_PATH, item["localPath"]?.toString() ?: "")
            put(COL_XFER_TRANSPORT, item["transportType"]?.toString() ?: "LAN_TCP")
        }
        return db.insertWithOnConflict(TABLE_TRANSFERS, null, cv, SQLiteDatabase.CONFLICT_REPLACE) != -1L
    }

    fun getAllTransfers(): List<Map<String, Any>> {
        val list = mutableListOf<Map<String, Any>>()
        val db = readableDatabase
        val cursor = db.rawQuery("SELECT * FROM $TABLE_TRANSFERS ORDER BY $COL_XFER_TIMESTAMP DESC", null)
        cursor.use { c ->
            while (c.moveToNext()) {
                val localPath = c.getString(c.getColumnIndexOrThrow(COL_XFER_LOCAL_PATH)) ?: ""
                val isAvailable = localPath.isNotBlank() && java.io.File(localPath).exists()
                list.add(mapOf(
                        "id" to c.getString(c.getColumnIndexOrThrow(COL_XFER_ID)),
                        "timestamp" to c.getLong(c.getColumnIndexOrThrow(COL_XFER_TIMESTAMP)),
                        "senderName" to c.getString(c.getColumnIndexOrThrow(COL_XFER_SENDER)),
                        "receiverName" to c.getString(c.getColumnIndexOrThrow(COL_XFER_RECEIVER)),
                        "fileName" to c.getString(c.getColumnIndexOrThrow(COL_XFER_FILE_NAME)),
                        "fileType" to c.getString(c.getColumnIndexOrThrow(COL_XFER_FILE_TYPE)),
                        "fileSize" to c.getLong(c.getColumnIndexOrThrow(COL_XFER_FILE_SIZE)),
                        "direction" to c.getString(c.getColumnIndexOrThrow(COL_XFER_DIRECTION)),
                        "status" to c.getString(c.getColumnIndexOrThrow(COL_XFER_STATUS)),
                        "durationMs" to c.getLong(c.getColumnIndexOrThrow(COL_XFER_DURATION)),
                        "avgSpeed" to c.getLong(c.getColumnIndexOrThrow(COL_XFER_AVG_SPEED)),
                        "sha256" to c.getString(c.getColumnIndexOrThrow(COL_XFER_SHA256)),
                        "localPath" to localPath,
                        "transportType" to c.getString(c.getColumnIndexOrThrow(COL_XFER_TRANSPORT)),
                        "isAvailable" to isAvailable
                    ))
                }
            }
        return list
    }

    fun deleteTransfer(id: String): Boolean {
        return writableDatabase.delete(TABLE_TRANSFERS, "$COL_XFER_ID = ?", arrayOf(id)) > 0
    }

    fun clearAllTransfers(): Boolean {
        return writableDatabase.delete(TABLE_TRANSFERS, null, null) > 0
    }

    // -------------------------------------------------------------------------
    // CHAT METHODS
    // -------------------------------------------------------------------------
    fun insertChatMessage(msg: Map<String, Any>): Boolean {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put(COL_CHAT_ID, msg["id"]?.toString())
            put(COL_CHAT_PEER_ID, msg["peerId"]?.toString())
            put(COL_CHAT_PEER_NAME, msg["peerName"]?.toString())
            put(COL_CHAT_SENDER_ID, msg["senderId"]?.toString())
            put(COL_CHAT_TEXT, msg["text"]?.toString())
            put(COL_CHAT_TIMESTAMP, (msg["timestamp"] as? Number)?.toLong() ?: System.currentTimeMillis())
            put(COL_CHAT_STATUS, msg["status"]?.toString() ?: "sent")
        }
        return db.insertWithOnConflict(TABLE_CHATS, null, cv, SQLiteDatabase.CONFLICT_REPLACE) != -1L
    }

    fun getChatMessages(peerId: String): List<Map<String, Any>> {
        val list = mutableListOf<Map<String, Any>>()
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT * FROM $TABLE_CHATS WHERE $COL_CHAT_PEER_ID = ? ORDER BY $COL_CHAT_TIMESTAMP ASC",
            arrayOf(peerId)
        )
        cursor.use { c ->
            while (c.moveToNext()) {
                list.add(mapOf(
                    "id" to c.getString(c.getColumnIndexOrThrow(COL_CHAT_ID)),
                    "peerId" to c.getString(c.getColumnIndexOrThrow(COL_CHAT_PEER_ID)),
                    "peerName" to c.getString(c.getColumnIndexOrThrow(COL_CHAT_PEER_NAME)),
                    "senderId" to c.getString(c.getColumnIndexOrThrow(COL_CHAT_SENDER_ID)),
                    "text" to c.getString(c.getColumnIndexOrThrow(COL_CHAT_TEXT)),
                    "timestamp" to c.getLong(c.getColumnIndexOrThrow(COL_CHAT_TIMESTAMP)),
                    "status" to c.getString(c.getColumnIndexOrThrow(COL_CHAT_STATUS))
                ))
            }
        }
        return list
    }

    fun updateChatMessageStatus(messageId: String, status: String): Boolean {
        val cv = ContentValues().apply { put(COL_CHAT_STATUS, status) }
        return writableDatabase.update(TABLE_CHATS, cv, "$COL_CHAT_ID = ?", arrayOf(messageId)) > 0
    }

    // -------------------------------------------------------------------------
    // USER PROFILE
    // -------------------------------------------------------------------------
    fun getProfile(): Map<String, String> {
        val map = mutableMapOf<String, String>()
        val db = readableDatabase
        val cursor = db.rawQuery("SELECT * FROM $TABLE_PROFILE", null)
        cursor.use { c ->
            while (c.moveToNext()) {
                map[c.getString(c.getColumnIndexOrThrow(COL_PROF_KEY))] =
                    c.getString(c.getColumnIndexOrThrow(COL_PROF_VAL))
            }
        }
        return map
    }

    fun setProfileValue(key: String, value: String): Boolean {
        val cv = ContentValues().apply {
            put(COL_PROF_KEY, key)
            put(COL_PROF_VAL, value)
        }
        return writableDatabase.insertWithOnConflict(TABLE_PROFILE, null, cv, SQLiteDatabase.CONFLICT_REPLACE) != -1L
    }

    // -------------------------------------------------------------------------
    // TRUSTED PEERS
    // -------------------------------------------------------------------------
    fun getTrustedPeers(): List<Map<String, Any>> {
        val list = mutableListOf<Map<String, Any>>()
        val db = readableDatabase
        val cursor = db.rawQuery("SELECT * FROM $TABLE_TRUSTED", null)
        cursor.use { c ->
            while (c.moveToNext()) {
                list.add(mapOf(
                    "peerId" to c.getString(c.getColumnIndexOrThrow(COL_TRUST_PEER_ID)),
                    "peerName" to c.getString(c.getColumnIndexOrThrow(COL_TRUST_PEER_NAME)),
                    "trustedSince" to c.getLong(c.getColumnIndexOrThrow(COL_TRUST_TIMESTAMP))
                ))
            }
        }
        return list
    }

    fun setPeerTrusted(peerId: String, peerName: String, trusted: Boolean): Boolean {
        val db = writableDatabase
        return if (trusted) {
            val cv = ContentValues().apply {
                put(COL_TRUST_PEER_ID, peerId)
                put(COL_TRUST_PEER_NAME, peerName)
                put(COL_TRUST_TIMESTAMP, System.currentTimeMillis())
            }
            db.insertWithOnConflict(TABLE_TRUSTED, null, cv, SQLiteDatabase.CONFLICT_REPLACE) != -1L
        } else {
            db.delete(TABLE_TRUSTED, "$COL_TRUST_PEER_ID = ?", arrayOf(peerId)) > 0
        }
    }

    // -------------------------------------------------------------------------
    // BLOCKED PEERS
    // -------------------------------------------------------------------------
    fun isPeerBlocked(peerId: String): Boolean {
        val db = readableDatabase
        val cursor = db.rawQuery("SELECT 1 FROM $TABLE_BLOCKED WHERE $COL_BLOCK_PEER_ID = ?", arrayOf(peerId))
        cursor.use { return it.moveToFirst() }
    }

    fun setPeerBlocked(peerId: String, peerName: String, blocked: Boolean): Boolean {
        val db = writableDatabase
        return if (blocked) {
            val cv = ContentValues().apply {
                put(COL_BLOCK_PEER_ID, peerId)
                put(COL_BLOCK_PEER_NAME, peerName)
                put(COL_BLOCK_TIMESTAMP, System.currentTimeMillis())
            }
            db.insertWithOnConflict(TABLE_BLOCKED, null, cv, SQLiteDatabase.CONFLICT_REPLACE) != -1L
        } else {
            db.delete(TABLE_BLOCKED, "$COL_BLOCK_PEER_ID = ?", arrayOf(peerId)) > 0
        }
    }

    fun getBlockedPeers(): List<Map<String, Any>> {
        val list = mutableListOf<Map<String, Any>>()
        val db = readableDatabase
        val cursor = db.rawQuery("SELECT * FROM $TABLE_BLOCKED", null)
        cursor.use { c ->
            while (c.moveToNext()) {
                list.add(mapOf(
                    "peerId" to c.getString(c.getColumnIndexOrThrow(COL_BLOCK_PEER_ID)),
                    "peerName" to c.getString(c.getColumnIndexOrThrow(COL_BLOCK_PEER_NAME)),
                    "blockedSince" to c.getLong(c.getColumnIndexOrThrow(COL_BLOCK_TIMESTAMP))
                ))
            }
        }
        return list
    }

    // -------------------------------------------------------------------------
    // INCOMING SHARE REQUEST METHODS (Section 16)
    // -------------------------------------------------------------------------
    fun insertIncomingRequest(req: Map<String, Any>): Boolean {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put(COL_REQ_ID, req["requestId"]?.toString())
            put(COL_REQ_SESSION_ID, req["transferSessionId"]?.toString())
            put(COL_REQ_SENDER_DEVICE_ID, req["senderDeviceId"]?.toString())
            put(COL_REQ_SENDER_DISPLAY_NAME, req["senderDisplayName"]?.toString())
            put(COL_REQ_SENDER_DEVICE_NAME, req["senderDeviceName"]?.toString())
            put(COL_REQ_FILE_COUNT, (req["fileCount"] as? Number)?.toInt() ?: 1)
            put(COL_REQ_FILE_MANIFEST, req["fileManifest"]?.toString() ?: "[]")
            put(COL_REQ_TOTAL_BYTES, (req["totalBytes"] as? Number)?.toLong() ?: 0L)
            put(COL_REQ_CREATED_AT, (req["createdAt"] as? Number)?.toLong() ?: System.currentTimeMillis())
            put(COL_REQ_EXPIRES_AT, (req["expiresAt"] as? Number)?.toLong() ?: (System.currentTimeMillis() + 60000L))
            put(COL_REQ_STATUS, req["status"]?.toString() ?: "PENDING")
        }
        return db.insertWithOnConflict(TABLE_INCOMING_REQUESTS, null, cv, SQLiteDatabase.CONFLICT_REPLACE) != -1L
    }

    fun updateIncomingRequestStatus(requestId: String, status: String): Boolean {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put(COL_REQ_STATUS, status)
        }
        return db.update(TABLE_INCOMING_REQUESTS, cv, "$COL_REQ_ID = ?", arrayOf(requestId)) > 0
    }

    fun getIncomingRequest(requestId: String): Map<String, Any>? {
        val db = readableDatabase
        val cursor = db.rawQuery("SELECT * FROM $TABLE_INCOMING_REQUESTS WHERE $COL_REQ_ID = ?", arrayOf(requestId))
        cursor.use { c ->
            if (c.moveToFirst()) {
                return mapOf(
                    "requestId" to c.getString(c.getColumnIndexOrThrow(COL_REQ_ID)),
                    "transferSessionId" to c.getString(c.getColumnIndexOrThrow(COL_REQ_SESSION_ID)),
                    "senderDeviceId" to c.getString(c.getColumnIndexOrThrow(COL_REQ_SENDER_DEVICE_ID)),
                    "senderDisplayName" to c.getString(c.getColumnIndexOrThrow(COL_REQ_SENDER_DISPLAY_NAME)),
                    "senderDeviceName" to c.getString(c.getColumnIndexOrThrow(COL_REQ_SENDER_DEVICE_NAME)),
                    "fileCount" to c.getInt(c.getColumnIndexOrThrow(COL_REQ_FILE_COUNT)),
                    "fileManifest" to c.getString(c.getColumnIndexOrThrow(COL_REQ_FILE_MANIFEST)),
                    "totalBytes" to c.getLong(c.getColumnIndexOrThrow(COL_REQ_TOTAL_BYTES)),
                    "createdAt" to c.getLong(c.getColumnIndexOrThrow(COL_REQ_CREATED_AT)),
                    "expiresAt" to c.getLong(c.getColumnIndexOrThrow(COL_REQ_EXPIRES_AT)),
                    "status" to c.getString(c.getColumnIndexOrThrow(COL_REQ_STATUS))
                )
            }
        }
        return null
    }

    fun cleanupLegacyAuraDropUser(realDeviceName: String) {
        val db = writableDatabase
        try {
            db.execSQL("UPDATE $TABLE_PROFILE SET value = ? WHERE key = 'display_name' AND (value = 'AuraDrop User' OR value = '')", arrayOf(realDeviceName))
            db.execSQL("UPDATE $TABLE_PROFILE SET value = ? WHERE key = 'device_name' AND (value = 'My Device' OR value = 'AuraDrop Device' OR value = '')", arrayOf(realDeviceName))
        } catch (e: Exception) {}
    }
}
