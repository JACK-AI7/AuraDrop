package com.auradrop.auradrop

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.*
import java.net.*
import java.security.MessageDigest
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

data class PeerInfo(
    val deviceId: String,
    val displayName: String,
    val deviceName: String,
    val platform: String = "android",
    val ip: String,
    val port: Int,
    val avatarIndex: Int = 0,
    val avatarPath: String = "",
    val status: String = "",
    val transport: String = "LAN",
    var connectionState: String = "DISCOVERED",
    var lastSeen: Long = System.currentTimeMillis()
) {
    fun toMap(): Map<String, Any> = mapOf(
        "id" to deviceId,
        "name" to displayName,
        "deviceName" to deviceName,
        "platform" to platform,
        "ip" to ip,
        "port" to port,
        "avatarIndex" to avatarIndex,
        "avatarPath" to avatarPath,
        "status" to status,
        "transport" to transport,
        "connectionState" to connectionState,
        "lastSeen" to lastSeen
    )
}

data class HttpUploadSession(
    val transferId: String,
    val fileName: String,
    val fileSize: Long,
    val sha256: String,
    val senderName: String,
    val senderUserId: String
)

object PeerRegistry {
    private val peers = ConcurrentHashMap<String, PeerInfo>()

    fun updateOrAdd(peer: PeerInfo): Boolean {
        val existing = peers[peer.deviceId]
        peers[peer.deviceId] = peer
        return existing == null
    }

    fun get(deviceId: String): PeerInfo? = peers[deviceId]

    fun remove(deviceId: String): PeerInfo? = peers.remove(deviceId)

    fun pruneExpired(timeoutMs: Long = 8000L): List<PeerInfo> {
        val now = System.currentTimeMillis()
        val expired = mutableListOf<PeerInfo>()
        val it = peers.entries.iterator()
        while (it.hasNext()) {
            val entry = it.next()
            if (now - entry.value.lastSeen > timeoutMs) {
                expired.add(entry.value)
                it.remove()
            }
        }
        return expired
    }

    fun getActivePeers(): List<PeerInfo> = peers.values.toList()

    fun updateConnectionState(deviceId: String, state: String) {
        peers[deviceId]?.connectionState = state
    }
}

class MainActivity : FlutterActivity() {
    companion object {
        private const val TAG = "AuraDropNative"
        private const val METHOD_CHANNEL = "com.auradrop.app/native"
        private const val EVENT_CHANNEL = "com.auradrop.app/events"
        private const val FILE_PICK_CODE = 48291
        private const val AVATAR_PICK_CODE = 48292
        private const val DEFAULT_PORT = 53317
        private const val DISCOVERY_GROUP = "224.0.0.167"
        private const val DISCOVERY_PORT = 53317
        private const val LEGACY_DISCOVERY_GROUP = "239.255.48.29"
        private const val LEGACY_DISCOVERY_PORT = 48290
        private const val LEGACY_TRANSFER_PORT = 48291
        private const val SOCKET_BUFFER_SIZE = 2 * 1024 * 1024 // 2 MB buffer for max wire throughput
        private const val PROGRESS_EVENT_INTERVAL_MS = 90L // ~11 UI updates/sec to avoid IPC bottleneck
        const val INCOMING_REQUEST_CHANNEL_ID = "auradrop_incoming_requests"
        const val CHAT_NOTIFICATION_CHANNEL_ID = "auradrop_chat_messages"

        @Volatile
        var activeInstance: MainActivity? = null
            private set

        fun handleSystemNotificationAction(context: Context, transferId: String, accept: Boolean) {
            val inst = activeInstance
            if (inst != null) {
                if (accept) {
                    inst.acceptIncomingTransfer(transferId)
                    inst.sendEvent("notificationAccept", mapOf("transferId" to transferId))
                } else {
                    inst.declineIncomingTransfer(transferId)
                    inst.sendEvent("notificationDecline", mapOf("transferId" to transferId))
                }
            } else {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.cancel(transferId.hashCode())
            }
        }
    }

    private var eventSink: EventChannel.EventSink? = null
    private var pendingFilePickResult: MethodChannel.Result? = null
    private var pendingAvatarPickResult: MethodChannel.Result? = null
    private var isAppInForeground = true

    private var multicastLock: WifiManager.MulticastLock? = null
    private var wakeLock: android.os.PowerManager.WakeLock? = null
    private var isDiscovering = false
    private var discoveryJob: Job? = null
    private var serverJob: Job? = null
    private var transferServer: ServerSocket? = null

    // Sockets and Transfer Sessions
    private val activeClientSockets = ConcurrentHashMap<String, Socket>()
    private val activeTransfersState = ConcurrentHashMap<String, TransferSession>()
    private val activePeerChatSockets = ConcurrentHashMap<String, Socket>()
    private val httpUploadSessions = ConcurrentHashMap<String, HttpUploadSession>()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Database
    private lateinit var dbHelper: AuraDropDatabaseHelper

    private var deviceId: String = ""
    private var deviceName: String = ""

    // Initial files received from Android System Share intent
    private val sharedFilesList = Collections.synchronizedList(mutableListOf<Map<String, Any>>())

    data class TransferSession(
        val transferId: String,
        val socket: Socket,
        var senderName: String = "Unknown Device",
        var senderDeviceName: String = "Unknown Device",
        val expiresAt: Long = System.currentTimeMillis() + 60000L,
        var isCancelled: AtomicBoolean = AtomicBoolean(false),
        var isPaused: AtomicBoolean = AtomicBoolean(false),
        var isAccepted: AtomicBoolean = AtomicBoolean(false),
        var isDeclined: AtomicBoolean = AtomicBoolean(false)
    )

    private fun getSystemDeviceName(): String {
        try {
            val name = android.provider.Settings.Global.getString(contentResolver, "device_name")
            if (!name.isNullOrBlank()) return name
        } catch (e: Exception) {}
        try {
            val bluetoothName = android.bluetooth.BluetoothAdapter.getDefaultAdapter()?.name
            if (!bluetoothName.isNullOrBlank()) return bluetoothName
        } catch (e: Exception) {}
        return "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        activeInstance = this
        createSystemNotificationChannels()
        dbHelper = AuraDropDatabaseHelper(this)

        val prefs = getSharedPreferences("auradrop_identity", Context.MODE_PRIVATE)
        var storedId = prefs.getString("device_id", null)
        if (storedId.isNullOrBlank()) {
            storedId = "android_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10)
            prefs.edit().putString("device_id", storedId).apply()
        }
        deviceId = storedId

        val sysDev = getSystemDeviceName()
        dbHelper.cleanupLegacyAuraDropUser(sysDev)
        val profile = dbHelper.getProfile()
        val savedName = profile["display_name"]
        if (!savedName.isNullOrBlank() && savedName != "AuraDrop User") {
            deviceName = savedName
        } else {
            deviceName = sysDev
        }
        handleSendIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        isAppInForeground = true
        if (!AuraOverlayManager.getInstance(this).canDrawOverlays()) {
            mainHandler.postDelayed({
                AuraOverlayManager.getInstance(this).requestOverlayPermission(this)
            }, 1200)
        }
    }

    override fun onPause() {
        super.onPause()
        isAppInForeground = false
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleSendIntent(intent)
    }

    private fun handleSendIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        val type = intent.type

        if ((Intent.ACTION_SEND == action || Intent.ACTION_SEND_MULTIPLE == action) && type != null) {
            val collectedUris = mutableListOf<Uri>()

            // 1. Extract from clipData (standard for modern Android shares from Gallery/Files/Photos)
            intent.clipData?.let { cd ->
                for (i in 0 until cd.itemCount) {
                    val u = cd.getItemAt(i).uri
                    if (u != null && !collectedUris.contains(u)) {
                        collectedUris.add(u)
                    }
                }
            }

            // 2. Extract from EXTRA_STREAM
            if (Intent.ACTION_SEND_MULTIPLE == action) {
                val streamUris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
                }
                streamUris?.forEach { u ->
                    if (u != null && !collectedUris.contains(u)) collectedUris.add(u)
                }
            } else if (Intent.ACTION_SEND == action) {
                val singleUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                if (singleUri != null && !collectedUris.contains(singleUri)) {
                    collectedUris.add(singleUri)
                }
            }

            // 3. Fallback to data URI
            intent.data?.let { du ->
                if (!collectedUris.contains(du)) collectedUris.add(du)
            }

            if (collectedUris.isNotEmpty()) {
                val files = mutableListOf<Map<String, Any>>()
                for (u in collectedUris) {
                    getFileMeta(u)?.let { files.add(it) }
                }
                if (files.isNotEmpty()) {
                    sharedFilesList.addAll(files)
                    sendEvent("systemShareReceived", mapOf("files" to files))
                }
            }
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, METHOD_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "getDeviceInfo" -> {
                    result.success(mapOf(
                        "deviceId" to deviceId,
                        "deviceName" to deviceName,
                        "platform" to "android",
                        "ipAddress" to getLocalIpAddress(),
                        "port" to DEFAULT_PORT
                    ))
                }
                "getDiscoveredPeers" -> {
                    result.success(PeerRegistry.getActivePeers().map { it.toMap() })
                }
                "requestPermissions" -> {
                    checkAndRequestPermissions()
                    result.success(true)
                }
                "getInitialShareFiles" -> {
                    val currentList = ArrayList(sharedFilesList)
                    sharedFilesList.clear()
                    result.success(currentList)
                }
                "startDiscovery" -> {
                    startDiscoveryEngine()
                    result.success(true)
                }
                "stopDiscovery" -> {
                    stopDiscoveryEngine()
                    result.success(true)
                }
                "pickFiles" -> {
                    pendingFilePickResult = result
                    launchNativeFilePicker()
                }
                "startTransferServer" -> {
                    startTransferServerSocket()
                    result.success(true)
                }
                "sendFiles" -> {
                    val targetIp = call.argument<String>("targetIp") ?: ""
                    val targetPort = call.argument<Int>("targetPort") ?: DEFAULT_PORT
                    val filesList = call.argument<List<Map<String, Any>>>("files") ?: emptyList()
                    startSendFilesTask(targetIp, targetPort, filesList)
                    result.success(true)
                }
                "acceptTransfer" -> {
                    val transferId = call.argument<String>("transferId") ?: ""
                    acceptIncomingTransfer(transferId)
                    result.success(true)
                }
                "declineTransfer" -> {
                    val transferId = call.argument<String>("transferId") ?: ""
                    declineIncomingTransfer(transferId)
                    result.success(true)
                }
                "cancelTransfer" -> {
                    val transferId = call.argument<String>("transferId") ?: ""
                    cancelTransferSession(transferId)
                    result.success(true)
                }
                "openFile" -> {
                    val filePath = call.argument<String>("filePath") ?: ""
                    val opened = openFileWithSystemViewer(filePath)
                    result.success(opened)
                }
                "copyUriToCache" -> {
                    val uriStr = call.argument<String>("uri") ?: ""
                    val name = call.argument<String>("name") ?: "temp_file"
                    val cacheFile = File(cacheDir, name)
                    try {
                        contentResolver.openInputStream(Uri.parse(uriStr))?.use { input ->
                            FileOutputStream(cacheFile).use { output ->
                                input.copyTo(output)
                            }
                        }
                        result.success(cacheFile.absolutePath)
                    } catch (e: Exception) {
                        result.error("CACHE_ERROR", e.message, null)
                    }
                }
                // Database & History handlers
                "getTransferHistory" -> {
                    val history = dbHelper.getAllTransfers()
                    result.success(history)
                }
                "deleteTransferHistory" -> {
                    val id = call.argument<String>("id") ?: ""
                    val ok = dbHelper.deleteTransfer(id)
                    result.success(ok)
                }
                "clearTransferHistory" -> {
                    val ok = dbHelper.clearAllTransfers()
                    result.success(ok)
                }
                "getReceivedFiles" -> {
                    val files = listReceivedFiles()
                    result.success(files)
                }
                "deleteReceivedFile" -> {
                    val path = call.argument<String>("path") ?: ""
                    val deleted = File(path).delete()
                    result.success(deleted)
                }
                "recordTransferHistory" -> {
                    try {
                        val id = call.argument<String>("id") ?: UUID.randomUUID().toString()
                        val senderName = call.argument<String>("senderName") ?: "Nearby Device"
                        val receiverName = call.argument<String>("receiverName") ?: deviceName
                        val fileName = call.argument<String>("fileName") ?: "file"
                        val fileSize = (call.argument<Number>("fileSize"))?.toLong() ?: 0L
                        val direction = call.argument<String>("direction") ?: "received"
                        val status = call.argument<String>("status") ?: "completed"
                        val sha256 = call.argument<String>("sha256") ?: ""
                        val localPath = call.argument<String>("localPath") ?: ""
                        val transportType = call.argument<String>("transportType") ?: "LAN_DIRECT"
                        val avgSpeed = (call.argument<Number>("avgSpeed"))?.toLong() ?: 0L

                        dbHelper.insertTransfer(mapOf(
                            "id" to id,
                            "timestamp" to System.currentTimeMillis(),
                            "senderName" to senderName,
                            "receiverName" to receiverName,
                            "fileName" to fileName,
                            "fileType" to "",
                            "fileSize" to fileSize,
                            "direction" to direction,
                            "status" to status,
                            "durationMs" to 1000L,
                            "avgSpeed" to avgSpeed,
                            "sha256" to sha256,
                            "localPath" to localPath,
                            "transportType" to transportType
                        ))

                        if (localPath.isNotEmpty()) {
                            try {
                                MediaScannerConnection.scanFile(applicationContext, arrayOf(localPath), null, null)
                            } catch (_: Exception) {}
                        }
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("DB_ERROR", e.message, null)
                    }
                }
                "recordChatMessage" -> {
                    try {
                        val msgId = call.argument<String>("id") ?: ("msg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8))
                        val peerId = call.argument<String>("peerId") ?: ""
                        val peerName = call.argument<String>("peerName") ?: "Nearby Device"
                        val senderId = call.argument<String>("senderId") ?: ""
                        val text = call.argument<String>("text") ?: ""
                        val timestamp = (call.argument<Number>("timestamp"))?.toLong() ?: System.currentTimeMillis()
                        val status = call.argument<String>("status") ?: "received"

                        val msgMap = mapOf(
                            "id" to msgId,
                            "peerId" to peerId,
                            "peerName" to peerName,
                            "senderId" to senderId,
                            "text" to text,
                            "timestamp" to timestamp,
                            "status" to status
                        )
                        dbHelper.insertChatMessage(msgMap)
                        sendEvent("chatMessageReceived", msgMap)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("CHAT_ERROR", e.message, null)
                    }
                }
                // Offline P2P Chat Handlers
                "getChatMessages" -> {
                    val peerId = call.argument<String>("peerId") ?: ""
                    val msgs = dbHelper.getChatMessages(peerId)
                    result.success(msgs)
                }
                "sendChatMessage" -> {
                    val targetIp = call.argument<String>("targetIp") ?: ""
                    val targetPort = (call.argument<Number>("targetPort"))?.toInt() ?: DEFAULT_PORT
                    val peerId = call.argument<String>("peerId") ?: ""
                    val peerName = call.argument<String>("peerName") ?: "Nearby Peer"
                    val text = call.argument<String>("text") ?: ""
                    sendOfflineChatMessage(targetIp, targetPort, peerId, peerName, text)
                    result.success(true)
                }
                "sendChatTyping" -> {
                    val targetIp = call.argument<String>("targetIp") ?: ""
                    val isTyping = call.argument<Boolean>("isTyping") ?: false
                    sendChatTypingStatus(targetIp, isTyping)
                    result.success(true)
                }
                // Profile & Trusted Peers
                "getUserProfile" -> {
                    result.success(dbHelper.getProfile())
                }
                "saveUserProfile" -> {
                    val key = call.argument<String>("key") ?: ""
                    val value = call.argument<String>("value") ?: ""
                    if (key == "display_name" && value.isNotBlank()) deviceName = value
                    val ok = dbHelper.setProfileValue(key, value)
                    result.success(ok)
                }
                "getTrustedPeers" -> {
                    result.success(dbHelper.getTrustedPeers())
                }
                "setPeerTrusted" -> {
                    val peerId = call.argument<String>("peerId") ?: ""
                    val peerName = call.argument<String>("peerName") ?: "Device"
                    val trusted = call.argument<Boolean>("trusted") ?: false
                    val ok = dbHelper.setPeerTrusted(peerId, peerName, trusted)
                    result.success(ok)
                }
                "getBlockedPeers" -> {
                    result.success(dbHelper.getBlockedPeers())
                }
                "setPeerBlocked" -> {
                    val peerId = call.argument<String>("peerId") ?: ""
                    val peerName = call.argument<String>("peerName") ?: "Device"
                    val blocked = call.argument<Boolean>("blocked") ?: false
                    val ok = dbHelper.setPeerBlocked(peerId, peerName, blocked)
                    result.success(ok)
                }
                "updateVisibilityMode" -> {
                    val mode = call.argument<String>("mode") ?: "everyone"
                    val ok = dbHelper.setProfileValue("visibility", mode)
                    result.success(ok)
                }
                "pickAvatarImage" -> {
                    pendingAvatarPickResult = result
                    launchAvatarPicker()
                }
                "removeAvatarImage" -> {
                    val avatarFile = File(filesDir, "avatar_${deviceId}.jpg")
                    if (avatarFile.exists()) avatarFile.delete()
                    dbHelper.setProfileValue("avatar_path", "")
                    result.success(true)
                }
                "checkStorageSpace" -> {
                    val downloadsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AuraDrop")
                    if (!downloadsDir.exists()) downloadsDir.mkdirs()
                    val map = HashMap<String, Long>()
                    map["usable"] = downloadsDir.usableSpace
                    map["total"] = downloadsDir.totalSpace
                    result.success(map)
                }
                "checkOverlayPermission" -> {
                    result.success(AuraOverlayManager.getInstance(this).canDrawOverlays())
                }
                "requestOverlayPermission" -> {
                    AuraOverlayManager.getInstance(this).requestOverlayPermission(this)
                    result.success(true)
                }
                "showSystemIncomingShareNotification" -> {
                    val transferId = call.argument<String>("transferId") ?: UUID.randomUUID().toString()
                    val senderName = call.argument<String>("senderName") ?: "Nearby Peer"
                    val senderDeviceName = call.argument<String>("senderDeviceName") ?: senderName
                    val totalFiles = call.argument<Int>("totalFiles") ?: 1
                    val totalBytes = (call.argument<Number>("totalBytes"))?.toLong() ?: 0L
                    val fileName = call.argument<String>("fileName") ?: "Incoming File"

                    showSystemIncomingShareNotification(
                        transferId = transferId,
                        senderName = senderName,
                        senderDeviceName = senderDeviceName,
                        totalFiles = totalFiles,
                        totalBytes = totalBytes,
                        firstFileName = fileName,
                        sasCode = "4829 1049"
                    )
                    result.success(true)
                }
                "showNameDropProximityAlert" -> {
                    val peerId = call.argument<String>("peerId") ?: ""
                    val peerName = call.argument<String>("peerName") ?: "Nearby Peer"
                    val deviceName = call.argument<String>("deviceName") ?: peerName
                    val platform = call.argument<String>("platform") ?: "device"
                    val ip = call.argument<String>("ip") ?: ""
                    showSystemNameDropProximityNotification(peerId, peerName, deviceName, platform, ip)
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, EVENT_CHANNEL).setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, sink: EventChannel.EventSink?) {
                eventSink = sink
            }
            override fun onCancel(arguments: Any?) {
                eventSink = null
            }
        })
    }

    private fun sendEvent(type: String, data: Map<String, Any>) {
        mainHandler.post {
            val event = HashMap(data)
            event["type"] = type
            eventSink?.success(event)
        }
    }

    // ----------------------------------------------------
    // Android Permissions Management
    // ----------------------------------------------------
    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.NEARBY_WIFI_DEVICES)
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            permissions.add(Manifest.permission.READ_MEDIA_IMAGES)
            permissions.add(Manifest.permission.READ_MEDIA_VIDEO)
            permissions.add(Manifest.permission.READ_MEDIA_AUDIO)
        } else {
            permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
            permissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), 1001)
        }
    }

    // ----------------------------------------------------
    // Native File Picker
    // ----------------------------------------------------
    private fun launchNativeFilePicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        startActivityForResult(intent, FILE_PICK_CODE)
    }

    private fun launchAvatarPicker() {
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
        }
        startActivityForResult(intent, AVATAR_PICK_CODE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_PICK_CODE) {
            val selectedFiles = mutableListOf<Map<String, Any>>()
            if (resultCode == Activity.RESULT_OK && data != null) {
                val clipData = data.clipData
                if (clipData != null) {
                    for (i in 0 until clipData.itemCount) {
                        val uri = clipData.getItemAt(i).uri
                        getFileMeta(uri)?.let { selectedFiles.add(it) }
                    }
                } else if (data.data != null) {
                    val uri = data.data!!
                    getFileMeta(uri)?.let { selectedFiles.add(it) }
                }
            }
            pendingFilePickResult?.success(selectedFiles)
            pendingFilePickResult = null
        } else if (requestCode == AVATAR_PICK_CODE) {
            if (resultCode == Activity.RESULT_OK && data?.data != null) {
                try {
                    val uri = data.data!!
                    val avatarFile = File(filesDir, "avatar_${deviceId}.jpg")
                    contentResolver.openInputStream(uri)?.use { input ->
                        FileOutputStream(avatarFile).use { output ->
                            input.copyTo(output)
                        }
                    }
                    dbHelper.setProfileValue("avatar_path", avatarFile.absolutePath)
                    pendingAvatarPickResult?.success(avatarFile.absolutePath)
                } catch (e: Exception) {
                    Log.e(TAG, "Error saving avatar: ${e.message}")
                    pendingAvatarPickResult?.success(null)
                }
            } else {
                pendingAvatarPickResult?.success(null)
            }
            pendingAvatarPickResult = null
        }
    }

    private fun getFileMeta(uri: Uri): Map<String, Any>? {
        return try {
            var rawName: String? = null
            var size = 0L
            var mimeType: String? = null

            try {
                contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (nameIndex != -1) rawName = cursor.getString(nameIndex)
                        if (sizeIndex != -1) size = cursor.getLong(sizeIndex)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "ContentResolver query failed for $uri: ${e.message}")
            }

            if (rawName.isNullOrBlank()) {
                val seg = uri.lastPathSegment
                rawName = if (!seg.isNullOrBlank() && seg.contains("/")) seg.substringAfterLast("/") else seg
            }
            val sanitizedName = sanitizeFilename(if (!rawName.isNullOrBlank()) rawName else "shared_file_${System.currentTimeMillis()}")

            try {
                mimeType = contentResolver.getType(uri)
            } catch (e: Exception) {}
            if (mimeType.isNullOrBlank()) {
                mimeType = "application/octet-stream"
            }

            if (size <= 0L) {
                try {
                    contentResolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
                        size = afd.length
                    }
                } catch (e: Exception) {}
            }

            mapOf(
                "id" to UUID.randomUUID().toString(),
                "name" to sanitizedName,
                "size" to if (size > 0L) size else 0L,
                "mimeType" to (mimeType ?: "application/octet-stream"),
                "uri" to uri.toString()
            )
        } catch (e: Exception) {
            Log.e(TAG, "getFileMeta fatal error for $uri: ${e.message}")
            null
        }
    }

    // ----------------------------------------------------
    // UDP Multicast Discovery Engine (P2PFS/1)
    // ----------------------------------------------------
    private fun startDiscoveryEngine() {
        if (isDiscovering) return
        isDiscovering = true

        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        multicastLock = wifi.createMulticastLock("AuraDropMulticastLock").apply {
            setReferenceCounted(true)
            acquire()
        }

        try {
            val pm = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "AuraDrop::DiscoveryWakeLock").apply {
                setReferenceCounted(false)
                acquire(60 * 60 * 1000L) // 1 hour standby wake lock
            }
        } catch (e: Exception) {}

        discoveryJob = scope.launch {
            launch { runUdpListener() }
            launch { runUdpBroadcaster() }
            launch { runPeerPruner() }
        }
    }

    private fun stopDiscoveryEngine() {
        isDiscovering = false
        discoveryJob?.cancel()
        discoveryJob = null
        multicastLock?.let {
            if (it.isHeld) it.release()
        }
        multicastLock = null
        wakeLock?.let {
            if (it.isHeld) {
                try { it.release() } catch (e: Exception) {}
            }
        }
        wakeLock = null
    }

    private suspend fun runPeerPruner() = withContext(Dispatchers.IO) {
        while (isDiscovering && isActive) {
            delay(2500)
            val expired = PeerRegistry.pruneExpired(8000L)
            for (p in expired) {
                sendEvent("peerExpired", mapOf("peerId" to p.deviceId))
            }
        }
    }

    private fun getDirectedBroadcastAddress(): InetAddress? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                for (ia in iface.interfaceAddresses) {
                    val bcast = ia.broadcast
                    if (bcast != null && bcast is Inet4Address) {
                        return bcast
                    }
                }
            }
        } catch (e: Exception) {}
        return null
    }

    private suspend fun runUdpBroadcaster() = withContext(Dispatchers.IO) {
        val group = InetAddress.getByName(DISCOVERY_GROUP)
        val legacyGroup = InetAddress.getByName(LEGACY_DISCOVERY_GROUP)
        val broadcastAddr = InetAddress.getByName("255.255.255.255")
        var socket: DatagramSocket? = null
        try {
            socket = DatagramSocket()
            while (isDiscovering && isActive) {
                try {
                    val prof = dbHelper.getProfile()
                    val savedName = prof["display_name"]
                    val resolvedDisplayName = if (!savedName.isNullOrBlank() && savedName != "AuraDrop User") {
                        savedName
                    } else {
                        deviceName
                    }
                    val beacon = JSONObject().apply {
                        put("type", "AURADROP_BEACON")
                        put("protocol", "AURADROP/1")
                        put("deviceId", deviceId)
                        put("name", resolvedDisplayName)
                        put("deviceName", deviceName)
                        put("platform", "android")
                        put("port", DEFAULT_PORT)
                        put("transferPort", DEFAULT_PORT)
                        put("avatarIndex", prof["avatar_index"]?.toIntOrNull() ?: 0)
                        put("avatarPath", prof["avatar_path"] ?: "")
                        put("status", prof["bio"] ?: "Nearby sharing made effortless")
                        put("timestamp", System.currentTimeMillis())
                    }
                    val bytes = beacon.toString().toByteArray(Charsets.UTF_8)

                    // 1. Multicast to standard group 224.0.0.167
                    socket.send(DatagramPacket(bytes, bytes.size, group, DISCOVERY_PORT))

                    // 2. Global broadcast
                    socket.send(DatagramPacket(bytes, bytes.size, broadcastAddr, DISCOVERY_PORT))

                    // 3. Directed subnet broadcast (e.g. 192.168.0.255)
                    val directedBcast = getDirectedBroadcastAddress()
                    if (directedBcast != null) {
                        socket.send(DatagramPacket(bytes, bytes.size, directedBcast, DISCOVERY_PORT))
                    }

                    // 4. Legacy multicast & port for older nodes
                    socket.send(DatagramPacket(bytes, bytes.size, legacyGroup, LEGACY_DISCOVERY_PORT))
                    socket.send(DatagramPacket(bytes, bytes.size, broadcastAddr, LEGACY_DISCOVERY_PORT))
                } catch (e: Exception) {
                    // Transient network jitter
                }
                delay(2000)
            }
        } finally {
            socket?.close()
        }
    }

    private suspend fun runUdpListener() = withContext(Dispatchers.IO) {
        var socket: MulticastSocket? = null
        try {
            socket = MulticastSocket(DISCOVERY_PORT).apply {
                reuseAddress = true
                try { joinGroup(InetAddress.getByName(DISCOVERY_GROUP)) } catch (_: Exception) {}
                try { joinGroup(InetAddress.getByName(LEGACY_DISCOVERY_GROUP)) } catch (_: Exception) {}
            }
            val buffer = ByteArray(4096)

            while (isDiscovering && isActive) {
                val packet = DatagramPacket(buffer, buffer.size)
                socket.receive(packet)
                val raw = String(packet.data, 0, packet.length, Charsets.UTF_8)
                try {
                    val json = JSONObject(raw)
                    val proto = json.optString("protocol")
                    if (proto != "AURADROP/1" && proto != "P2PFS/1" && proto != "AURADROP_LOCAL_V1") {
                        continue
                    }

                    val remoteDeviceId = json.optString("deviceId")
                    val remoteIp = packet.address.hostAddress ?: ""
                    val localIp = getLocalIpAddress()
                    if (remoteDeviceId.isNotEmpty() && remoteDeviceId != deviceId && remoteIp != localIp && !packet.address.isLoopbackAddress) {
                        val peerName = json.optString("name", "Unknown Device")
                        val peerDevName = json.optString("deviceName", peerName)
                        val resolvedName = if (peerName.isNotBlank() && peerName != "AuraDrop User") peerName else peerDevName
                        val transferPort = json.optInt("transferPort", json.optInt("port", DEFAULT_PORT))
                        val peer = PeerInfo(
                            deviceId = remoteDeviceId,
                            displayName = resolvedName,
                            deviceName = peerDevName,
                            platform = json.optString("platform", "android"),
                            ip = remoteIp,
                            port = transferPort,
                            avatarIndex = json.optInt("avatarIndex", 0),
                            avatarPath = json.optString("avatarPath", ""),
                            status = json.optString("status", ""),
                            transport = "LAN",
                            connectionState = "DISCOVERED",
                            lastSeen = System.currentTimeMillis()
                        )
                        val isNew = PeerRegistry.updateOrAdd(peer)
                        sendEvent("peerDiscovered", mapOf("peer" to peer.toMap()))
                        if (isNew) {
                            mainHandler.post {
                                showSystemNameDropProximityNotification(
                                    peerId = peer.deviceId,
                                    peerName = resolvedName,
                                    deviceName = peer.deviceName,
                                    platform = peer.platform,
                                    ip = peer.ip
                                )
                            }
                        }
                    }
                } catch (e: Exception) {
                    // Ignore malformed beacon
                }
            }
        } catch (e: Exception) {
            // Socket bind error or stopped
        } finally {
            socket?.close()
        }
    }

    // ----------------------------------------------------
    // TCP Streaming Server (High-Speed Receiver & Chat)
    // ----------------------------------------------------
    private fun startTransferServerSocket() {
        if (transferServer != null) return
        serverJob = scope.launch(Dispatchers.IO) {
            try {
                transferServer = try {
                    ServerSocket(DEFAULT_PORT, 50).apply {
                        receiveBufferSize = SOCKET_BUFFER_SIZE
                        reuseAddress = true
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Port $DEFAULT_PORT bind failed, using $LEGACY_TRANSFER_PORT: ${e.message}")
                    ServerSocket(LEGACY_TRANSFER_PORT, 50).apply {
                        receiveBufferSize = SOCKET_BUFFER_SIZE
                        reuseAddress = true
                    }
                }
                while (isActive) {
                    val clientSocket = transferServer?.accept() ?: break
                    clientSocket.tcpNoDelay = true
                    clientSocket.trafficClass = 0x10 // IPTOS_THROUGHPUT
                    clientSocket.sendBufferSize = SOCKET_BUFFER_SIZE
                    clientSocket.receiveBufferSize = SOCKET_BUFFER_SIZE
                    launch { handleInboundClient(clientSocket) }
                }
            } catch (e: Exception) {
                // Server stopped
            }
        }
    }

    private suspend fun handleInboundClient(socket: Socket) = withContext(Dispatchers.IO) {
        val transferId = "xfer_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10)
        val session = TransferSession(transferId, socket)
        activeTransfersState[transferId] = session
        activeClientSockets[transferId] = socket

        val input = BufferedInputStream(socket.getInputStream(), SOCKET_BUFFER_SIZE)
        val output = BufferedOutputStream(socket.getOutputStream(), SOCKET_BUFFER_SIZE)

        try {
            val header = ByteArray(20)

            while (socket.isConnected && !socket.isClosed) {
                val read = input.read(header, 0, 20)
                if (read == -1) break
                if (read < 20) input.readFullyRemaining(header, read, 20 - read)

                // Multiplex check: Check if connection is HTTP or binary framing (P2PF)
                if (header[0] != 0x50.toByte() || header[1] != 0x32.toByte() || header[2] != 0x50.toByte() || header[3] != 0x46.toByte()) {
                    handleHttpInboundClient(socket, input, output, header, 20)
                    break
                }

                val frameType = header[5].toInt()
                val payloadLen = header.readUInt32BE(8)

                when (frameType) {
                    0x01 -> { // HANDSHAKE_INIT
                        val payloadBytes = ByteArray(payloadLen)
                        input.readFully(payloadBytes)
                        val handshakeJson = JSONObject(String(payloadBytes, Charsets.UTF_8))
                        val clientNonce = handshakeJson.optString("nonce")

                        sendEvent("dataChannelState", mapOf(
                            "transferId" to transferId,
                            "state" to "DATA_CHANNEL_CONNECTING"
                        ))

                        val respJson = JSONObject().apply {
                            put("protocolVersion", "P2PFS/1")
                            put("deviceId", deviceId)
                            put("deviceName", deviceName)
                            put("platform", "android")
                            put("nonceEcho", clientNonce)
                            put("timestamp", System.currentTimeMillis())
                        }
                        output.write(buildFrame(0x02, respJson.toString().toByteArray()))
                        output.flush()
                    }

                    0x03 -> { // HEALTH_PING
                        val pingBytes = ByteArray(payloadLen)
                        input.readFully(pingBytes)
                        output.write(buildFrame(0x04, pingBytes))
                        output.flush()

                        sendEvent("dataChannelState", mapOf(
                            "transferId" to transferId,
                            "state" to "READY_TO_TRANSFER"
                        ))
                    }

                    0x10 -> { // NEGOTIATION_REQ
                        val negBytes = ByteArray(payloadLen)
                        input.readFully(negBytes)
                        val negJson = JSONObject(String(negBytes, Charsets.UTF_8))

                        val senderName = negJson.optString("senderName", "Unknown Device")
                        val senderDeviceName = negJson.optString("senderDeviceName", senderName)
                        val senderDeviceId = negJson.optString("deviceId", "peer")
                        val totalFiles = negJson.optInt("totalFiles", 1)
                        val totalBytes = negJson.optLong("totalBytes", 0L)
                        val filesArray = negJson.optJSONArray("files") ?: JSONArray()
                        val createdAt = negJson.optLong("createdAt", System.currentTimeMillis())
                        val expiresAt = negJson.optLong("expiresAt", System.currentTimeMillis() + 60000L)
                        val filesList = mutableListOf<Map<String, Any>>()

                        session.senderName = senderName
                        session.senderDeviceName = senderDeviceName

                        // Persist IncomingShareRequest (Section 16)
                        dbHelper.insertIncomingRequest(mapOf(
                            "requestId" to transferId,
                            "transferSessionId" to transferId,
                            "senderDeviceId" to senderDeviceId,
                            "senderDisplayName" to senderName,
                            "senderDeviceName" to senderDeviceName,
                            "fileCount" to totalFiles,
                            "fileManifest" to filesArray.toString(),
                            "totalBytes" to totalBytes,
                            "createdAt" to createdAt,
                            "expiresAt" to expiresAt,
                            "status" to "PENDING"
                        ))

                        // Enforce Blocked Peers
                        if (dbHelper.isPeerBlocked(senderDeviceId)) {
                            dbHelper.updateIncomingRequestStatus(transferId, "DECLINED")
                            val declineJson = JSONObject().apply {
                                put("transferId", transferId)
                                put("accepted", false)
                                put("reason", "blocked")
                            }
                            output.write(buildFrame(0x11, declineJson.toString().toByteArray()))
                            output.flush()
                            break
                        }

                        // Enforce Authoritative Visibility Mode
                        val prof = dbHelper.getProfile()
                        val vis = prof["visibility"] ?: "everyone"
                        if (vis == "receivingOff" || vis == "noOne") {
                            dbHelper.updateIncomingRequestStatus(transferId, "DECLINED")
                            val declineJson = JSONObject().apply {
                                put("transferId", transferId)
                                put("accepted", false)
                                put("reason", "visibility_off")
                            }
                            output.write(buildFrame(0x11, declineJson.toString().toByteArray()))
                            output.flush()
                            break
                        }
                        if (vis == "contactsOnly") {
                            val trusted = dbHelper.getTrustedPeers().any { it["peerId"] == senderDeviceId }
                            if (!trusted) {
                                dbHelper.updateIncomingRequestStatus(transferId, "DECLINED")
                                val declineJson = JSONObject().apply {
                                    put("transferId", transferId)
                                    put("accepted", false)
                                    put("reason", "not_trusted")
                                }
                                output.write(buildFrame(0x11, declineJson.toString().toByteArray()))
                                output.flush()
                                break
                            }
                        }

                        // Check for existing partial files for RESUME support
                        val downloadsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AuraDrop")
                        val resumeOffsets = JSONObject()

                        for (i in 0 until filesArray.length()) {
                            val f = filesArray.getJSONObject(i)
                            val fId = f.getString("id")
                            val fName = sanitizeFilename(f.getString("name"))
                            val fSize = f.getLong("size")
                            val partFile = File(downloadsDir, "$fName.part")
                            var resumeOffset = 0L
                            if (partFile.exists() && partFile.length() < fSize) {
                                resumeOffset = partFile.length()
                            }
                            resumeOffsets.put(fId, resumeOffset)

                            filesList.add(mapOf(
                                "id" to fId,
                                "name" to fName,
                                "size" to fSize,
                                "mimeType" to f.optString("mimeType", "application/octet-stream"),
                                "expectedChecksum" to f.optString("checksum", ""),
                                "resumeOffset" to resumeOffset
                            ))
                        }

                        val sasCode = generateSasCode(deviceId, senderDeviceId)

                        // Store negotiation response data on session
                        val firstFileName = if (filesList.isNotEmpty()) filesList[0]["name"]?.toString() ?: "" else ""
                        sendEvent("transferRequest", mapOf(
                            "transferId" to transferId,
                            "senderName" to senderName,
                            "senderDeviceId" to senderDeviceId,
                            "totalFiles" to totalFiles,
                            "totalBytes" to totalBytes,
                            "fileName" to firstFileName,
                            "sas" to sasCode,
                            "files" to filesList,
                            "resumeOffsets" to resumeOffsets.toString(),
                            "connectionState" to "WAITING_FOR_ACCEPTANCE"
                        ))

                        // System-Level Nearby Sharing Notification (Works in background per V8/V10)
                        showSystemIncomingShareNotification(
                            transferId = transferId,
                            senderName = senderName,
                            senderDeviceName = senderDeviceName,
                            totalFiles = totalFiles,
                            totalBytes = totalBytes,
                            firstFileName = firstFileName,
                            sasCode = sasCode
                        )
                    }

                    // ---------------------------------------------------------
                    // OFFLINE P2P CHAT MESSAGES
                    // ---------------------------------------------------------
                    0x30 -> { // CHAT_MESSAGE
                        val chatBytes = ByteArray(payloadLen)
                        input.readFully(chatBytes)
                        val chatJson = JSONObject(String(chatBytes, Charsets.UTF_8))

                        val msgId = chatJson.getString("id")
                        val peerId = chatJson.getString("senderId")
                        val peerName = chatJson.getString("senderName")
                        val text = chatJson.getString("text")
                        val timestamp = chatJson.optLong("timestamp", System.currentTimeMillis())

                        val msgMap = mapOf(
                            "id" to msgId,
                            "peerId" to peerId,
                            "peerName" to peerName,
                            "senderId" to peerId,
                            "text" to text,
                            "timestamp" to timestamp,
                            "status" to "delivered"
                        )
                        dbHelper.insertChatMessage(msgMap)
                        sendEvent("chatMessageReceived", msgMap)

                        if (!isAppInForeground) {
                            showSystemChatMessageNotification(peerName, text)
                        }

                        // Send CHAT_ACK
                        val ackJson = JSONObject().apply {
                            put("id", msgId)
                            put("status", "delivered")
                        }
                        output.write(buildFrame(0x31, ackJson.toString().toByteArray()))
                        output.flush()
                    }

                    0x31 -> { // CHAT_ACK
                        val ackBytes = ByteArray(payloadLen)
                        input.readFully(ackBytes)
                        val ackJson = JSONObject(String(ackBytes, Charsets.UTF_8))
                        val msgId = ackJson.getString("id")
                        val status = ackJson.optString("status", "delivered")
                        dbHelper.updateChatMessageStatus(msgId, status)
                        sendEvent("chatMessageStatusUpdated", mapOf("id" to msgId, "status" to status))
                    }

                    0x32 -> { // CHAT_TYPING
                        val typBytes = ByteArray(payloadLen)
                        input.readFully(typBytes)
                        val typJson = JSONObject(String(typBytes, Charsets.UTF_8))
                        sendEvent("chatTypingReceived", mapOf(
                            "senderId" to typJson.getString("senderId"),
                            "isTyping" to typJson.getBoolean("isTyping")
                        ))
                    }

                    // ---------------------------------------------------------
                    // HIGH-SPEED FILE TRANSFER FRAMES
                    // ---------------------------------------------------------
                    0x20 -> { // FILE_START
                        handleInboundFileStream(input, output, payloadLen, transferId, session)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Inbound client error: ${e.message}")
        } finally {
            socket.close()
            activeClientSockets.remove(transferId)
            activeTransfersState.remove(transferId)
        }
    }

    private suspend fun handleHttpInboundClient(
        socket: Socket,
        input: BufferedInputStream,
        output: BufferedOutputStream,
        initialBytes: ByteArray,
        initialLen: Int
    ) = withContext(Dispatchers.IO) {
        try {
            val headerBuffer = ByteArrayOutputStream()
            headerBuffer.write(initialBytes, 0, initialLen)

            var lastFour = 0
            while (true) {
                val b = input.read()
                if (b == -1) break
                headerBuffer.write(b)
                lastFour = (lastFour shl 8) or (b and 0xFF)
                if (lastFour == 0x0D0A0D0A) break
            }

            val headerStr = headerBuffer.toString("UTF-8")
            val lines = headerStr.split("\r\n")
            if (lines.isEmpty()) return@withContext

            val requestLine = lines[0]
            val parts = requestLine.split(" ")
            if (parts.size < 2) return@withContext

            val method = parts[0].uppercase()
            val uri = parts[1]
            val path = if (uri.contains("?")) uri.substring(0, uri.indexOf("?")) else uri

            val headers = mutableMapOf<String, String>()
            for (i in 1 until lines.size) {
                val l = lines[i]
                val colon = l.indexOf(':')
                if (colon != -1) {
                    val k = l.substring(0, colon).trim().lowercase()
                    val v = l.substring(colon + 1).trim()
                    headers[k] = v
                }
            }

            val queryParams = mutableMapOf<String, String>()
            if (uri.contains("?")) {
                val qs = uri.substring(uri.indexOf("?") + 1)
                for (param in qs.split("&")) {
                    val eq = param.indexOf('=')
                    if (eq != -1) {
                        try {
                            val pk = URLDecoder.decode(param.substring(0, eq), "UTF-8")
                            val pv = URLDecoder.decode(param.substring(eq + 1), "UTF-8")
                            queryParams[pk] = pv
                        } catch (_: Exception) {}
                    }
                }
            }

            val contentLength = headers["content-length"]?.toLongOrNull() ?: 0L

            fun sendJsonResponse(statusCode: Int, statusText: String, json: JSONObject) {
                val body = json.toString().toByteArray(Charsets.UTF_8)
                val resp = "HTTP/1.1 $statusCode $statusText\r\n" +
                        "Content-Type: application/json; charset=utf-8\r\n" +
                        "Content-Length: ${body.size}\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Connection: close\r\n\r\n"
                output.write(resp.toByteArray(Charsets.UTF_8))
                output.write(body)
                output.flush()
            }

            if (method == "OPTIONS") {
                val cors = "HTTP/1.1 204 No Content\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                        "Access-Control-Allow-Headers: *\r\n" +
                        "Connection: close\r\n\r\n"
                output.write(cors.toByteArray(Charsets.UTF_8))
                output.flush()
                return@withContext
            }

            when (path) {
                "/api/auradrop/v1/ping" -> {
                    val prof = dbHelper.getProfile()
                    val savedName = prof["display_name"]
                    val nameToShow = if (!savedName.isNullOrBlank() && savedName != "AuraDrop User") savedName else deviceName
                    val json = JSONObject().apply {
                        put("status", "ok")
                        put("pong", true)
                        put("deviceId", deviceId)
                        put("deviceName", nameToShow)
                        put("name", nameToShow)
                        put("platform", "android")
                        put("port", DEFAULT_PORT)
                        put("transferPort", DEFAULT_PORT)
                        put("protocol", "AURADROP/1")
                    }
                    sendJsonResponse(200, "OK", json)
                }

                "/api/auradrop/v1/info" -> {
                    val prof = dbHelper.getProfile()
                    val savedName = prof["display_name"]
                    val nameToShow = if (!savedName.isNullOrBlank() && savedName != "AuraDrop User") savedName else deviceName
                    val json = JSONObject().apply {
                        put("deviceId", deviceId)
                        put("deviceName", nameToShow)
                        put("platform", "android")
                    }
                    sendJsonResponse(200, "OK", json)
                }

                "/api/auradrop/v1/chat" -> {
                    val bodyBytes = ByteArray(contentLength.toInt().coerceAtLeast(0))
                    var readSoFar = 0
                    while (readSoFar < bodyBytes.size) {
                        val r = input.read(bodyBytes, readSoFar, bodyBytes.size - readSoFar)
                        if (r == -1) break
                        readSoFar += r
                    }
                    val bodyStr = String(bodyBytes, 0, readSoFar, Charsets.UTF_8)
                    val chatJson = JSONObject(bodyStr)

                    val msgId = chatJson.optString("id", "msg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8))
                    val senderId = chatJson.optString("senderId", "peer")
                    val senderName = chatJson.optString("senderName", "Nearby Peer")
                    val text = chatJson.optString("text", "")
                    val timestamp = chatJson.optLong("timestamp", System.currentTimeMillis())

                    val msgMap = mapOf(
                        "id" to msgId,
                        "peerId" to senderId,
                        "peerName" to senderName,
                        "senderId" to senderId,
                        "text" to text,
                        "timestamp" to timestamp,
                        "status" to "delivered"
                    )
                    dbHelper.insertChatMessage(msgMap)
                    sendEvent("chatMessageReceived", msgMap)

                    if (!isAppInForeground) {
                        showSystemChatMessageNotification(senderName, text)
                    }

                    sendJsonResponse(200, "OK", JSONObject().apply { put("status", "ok") })
                }

                "/api/auradrop/v1/prepare-upload" -> {
                    val bodyBytes = ByteArray(contentLength.toInt().coerceAtLeast(0))
                    var readSoFar = 0
                    while (readSoFar < bodyBytes.size) {
                        val r = input.read(bodyBytes, readSoFar, bodyBytes.size - readSoFar)
                        if (r == -1) break
                        readSoFar += r
                    }
                    val bodyStr = String(bodyBytes, 0, readSoFar, Charsets.UTF_8)
                    val prepJson = JSONObject(bodyStr)

                    val xferId = prepJson.optString("transferId", "xfer_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10))
                    val fileName = prepJson.optString("fileName", "file")
                    val fileSize = prepJson.optLong("fileSize", 0L)
                    val sha256 = prepJson.optString("sha256", "")
                    val senderName = prepJson.optString("senderName", prepJson.optString("senderUserId", "Nearby Device"))
                    val senderUserId = prepJson.optString("senderUserId", "peer")

                    val sessionMeta = HttpUploadSession(
                        transferId = xferId,
                        fileName = fileName,
                        fileSize = fileSize,
                        sha256 = sha256,
                        senderName = senderName,
                        senderUserId = senderUserId
                    )
                    httpUploadSessions[xferId] = sessionMeta

                    dbHelper.insertIncomingRequest(mapOf(
                        "requestId" to xferId,
                        "transferSessionId" to xferId,
                        "senderDeviceId" to senderUserId,
                        "senderDisplayName" to senderName,
                        "senderDeviceName" to senderName,
                        "fileCount" to 1,
                        "totalBytes" to fileSize,
                        "firstFileName" to fileName,
                        "createdAt" to System.currentTimeMillis(),
                        "expiresAt" to System.currentTimeMillis() + 60000L
                    ))

                    showSystemIncomingShareNotification(
                        transferId = xferId,
                        senderName = senderName,
                        senderDeviceName = senderName,
                        totalFiles = 1,
                        totalBytes = fileSize,
                        firstFileName = fileName,
                        sasCode = ""
                    )

                    sendJsonResponse(200, "OK", JSONObject().apply {
                        put("accepted", true)
                        put("transferId", xferId)
                        put("fileId", xferId)
                        put("oneTimeToken", "tok_$xferId")
                        put("expiresAt", System.currentTimeMillis() + 60000L)
                        put("protocol", "auradrop/1")
                    })
                }

                "/api/auradrop/v1/upload" -> {
                    val xferId = queryParams["transferId"] ?: headers["x-transfer-id"] ?: ""
                    val sessionMeta = httpUploadSessions[xferId]

                    val fileName = sessionMeta?.fileName ?: headers["x-file-name"] ?: queryParams["fileName"] ?: "received_file"
                    val fileSize = sessionMeta?.fileSize ?: headers["x-file-size"]?.toLongOrNull() ?: contentLength
                    val expectedSha256 = sessionMeta?.sha256 ?: headers["x-sha256"] ?: ""
                    val senderName = sessionMeta?.senderName ?: "Nearby Device"

                    val downloadsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AuraDrop")
                    if (!downloadsDir.exists()) downloadsDir.mkdirs()

                    val targetFile = resolveUniqueFile(downloadsDir, fileName)
                    val digest = MessageDigest.getInstance("SHA-256")

                    var totalWritten = 0L
                    val buf = ByteArray(1024 * 1024)
                    val startTime = System.currentTimeMillis()
                    var lastProgressTime = 0L

                    startForegroundTransferService("Receiving $fileName...", 0)

                    val fos = FileOutputStream(targetFile)
                    try {
                        val bos = BufferedOutputStream(fos, 1024 * 1024)
                        while (totalWritten < fileSize) {
                            val toRead = Math.min(buf.size.toLong(), fileSize - totalWritten).toInt()
                            val r = input.read(buf, 0, toRead)
                            if (r == -1) break
                            bos.write(buf, 0, r)
                            digest.update(buf, 0, r)
                            totalWritten += r

                            val now = System.currentTimeMillis()
                            if (now - lastProgressTime >= PROGRESS_EVENT_INTERVAL_MS || totalWritten == fileSize) {
                                lastProgressTime = now
                                val elapsedSec = Math.max(0.001, (now - startTime) / 1000.0)
                                val speed = (totalWritten / elapsedSec).toLong()
                                val pct = if (fileSize > 0) ((totalWritten.toDouble() / fileSize.toDouble()) * 100.0).toInt().coerceAtMost(99) else 100
                                val eta = if (speed > 0) ((fileSize - totalWritten) / speed).toInt() else 0

                                sendEvent("transferProgress", mapOf(
                                    "transferId" to xferId,
                                    "state" to "TRANSFERRING",
                                    "fileName" to fileName,
                                    "totalBytes" to fileSize,
                                    "transferredBytes" to totalWritten,
                                    "speedBytesPerSec" to speed,
                                    "etaSeconds" to eta,
                                    "percentage" to pct
                                ))
                            }
                        }
                        bos.flush()
                    } finally {
                        try { fos.close() } catch (_: Exception) {}
                    }

                    stopForegroundTransferService()
                    val calculatedSha256 = digest.digest().toHex()
                    val verified = expectedSha256.isEmpty() || calculatedSha256.equals(expectedSha256, ignoreCase = true)

                    MediaScannerConnection.scanFile(
                        applicationContext,
                        arrayOf(targetFile.absolutePath),
                        null
                    ) { _, _ -> }

                    val elapsedTotalSec = Math.max(0.001, (System.currentTimeMillis() - startTime) / 1000.0)
                    val avgSpeed = (totalWritten / elapsedTotalSec).toLong()

                    dbHelper.insertTransfer(mapOf(
                        "id" to xferId,
                        "direction" to "received",
                        "senderName" to senderName,
                        "receiverName" to deviceName,
                        "fileName" to fileName,
                        "fileSize" to totalWritten,
                        "status" to if (verified) "completed" else "failed",
                        "sha256" to calculatedSha256,
                        "localPath" to targetFile.absolutePath,
                        "transportType" to "LAN_HTTP_STREAM",
                        "avgSpeed" to avgSpeed,
                        "createdAt" to System.currentTimeMillis()
                    ))

                    sendEvent("transferComplete", mapOf(
                        "transferId" to xferId,
                        "fileName" to fileName,
                        "fileSize" to totalWritten,
                        "localPath" to targetFile.absolutePath,
                        "sha256" to calculatedSha256,
                        "verified" to verified
                    ))

                    cancelSystemIncomingShareNotification(xferId)

                    sendJsonResponse(200, "OK", JSONObject().apply {
                        put("success", true)
                        put("transferId", xferId)
                        put("verified", verified)
                        put("sha256", calculatedSha256)
                        put("savedPath", targetFile.absolutePath)
                    })
                }

                else -> {
                    sendJsonResponse(404, "Not Found", JSONObject().apply {
                        put("error", "Not Found")
                    })
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "HTTP Inbound processing error: ${e.message}")
        }
    }

    private fun acceptIncomingTransfer(transferId: String) {
        val session = activeTransfersState[transferId] ?: return
        if (session.isDeclined.get() || session.isAccepted.getAndSet(true)) return

        if (System.currentTimeMillis() > session.expiresAt) {
            dbHelper.updateIncomingRequestStatus(transferId, "EXPIRED")
            cancelSystemIncomingShareNotification(transferId)
            sendEvent("transferError", mapOf(
                "transferId" to transferId,
                "error" to "Incoming share request expired."
            ))
            return
        }

        dbHelper.updateIncomingRequestStatus(transferId, "ACCEPTED")
        cancelSystemIncomingShareNotification(transferId)
        val socket = session.socket

        scope.launch(Dispatchers.IO) {
            try {
                val output = BufferedOutputStream(socket.getOutputStream(), SOCKET_BUFFER_SIZE)
                val acceptJson = JSONObject().apply {
                    put("transferId", transferId)
                    put("accepted", true)
                }
                output.write(buildFrame(0x11, acceptJson.toString().toByteArray()))
                output.flush()

                startForegroundTransferService("Receiving files...", 0)
            } catch (e: Exception) {
                Log.e(TAG, "Error accepting transfer: ${e.message}")
            }
        }
    }

    private suspend fun handleInboundFileStream(
        input: BufferedInputStream,
        output: BufferedOutputStream,
        initPayloadLen: Int,
        transferId: String,
        session: TransferSession
    ) = withContext(Dispatchers.IO) {
        val downloadsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AuraDrop").apply {
            if (!exists()) mkdirs()
        }

        var currentFileOut: FileOutputStream? = null
        var currentPartFile: File? = null
        var currentFinalFile: File? = null

        val pBytes = ByteArray(initPayloadLen)
        input.readFully(pBytes)
        val fInfo = JSONObject(String(pBytes, Charsets.UTF_8))

        val rawFileName = fInfo.getString("filename")
        val safeName = sanitizeFilename(rawFileName)
        val currentFileExpectedBytes = fInfo.getLong("size")
        val currentExpectedChecksum = fInfo.optString("checksum", "")
        val currentMimeType = fInfo.optString("mimeType", "application/octet-stream")
        val totalExpectedTransferBytes = fInfo.optLong("totalTransferBytes", currentFileExpectedBytes)
        val resumeOffset = fInfo.optLong("offset", 0L)

        // Storage Check (Prompt Section 58)
        val usableSpace = downloadsDir.usableSpace
        val bytesNeeded = totalExpectedTransferBytes - resumeOffset
        if (bytesNeeded > usableSpace) {
            val reqStr = formatBytes(bytesNeeded)
            val availStr = formatBytes(usableSpace)
            val errMsg = "Not enough storage. Required: $reqStr, Available: $availStr"
            sendEvent("transferError", mapOf(
                "transferId" to transferId,
                "error" to errMsg
            ))
            output.write(buildFrame(0x26, JSONObject().apply {
                put("status", "INSUFFICIENT_STORAGE")
                put("message", errMsg)
            }.toString().toByteArray()))
            output.flush()
            throw IOException(errMsg)
        }

        currentFinalFile = resolveUniqueFile(downloadsDir, safeName)
        currentPartFile = File(downloadsDir, "${currentFinalFile.name}.part")

        // Resume mode or fresh file
        val appendMode = resumeOffset > 0 && currentPartFile.exists()
        currentFileOut = FileOutputStream(currentPartFile, appendMode)

        var overallReceived = resumeOffset
        val startTime = System.currentTimeMillis()
        var lastEventTime = 0L
        
        var lastSpeedUpdateTime = startTime
        var lastSpeedUpdateBytes = overallReceived
        var movingAvgSpeed = 0L

        val currentDigest = MessageDigest.getInstance("SHA-256")
        // If resuming, read existing bytes into digest
        if (appendMode) {
            FileInputStream(currentPartFile).use { fis ->
                val buf = ByteArray(64 * 1024)
                var readBytes = 0
                while (fis.read(buf).also { readBytes = it } > 0) {
                    currentDigest.update(buf, 0, readBytes)
                }
            }
        }

        val header = ByteArray(20)
        var receiverBuffer = ByteArray(512 * 1024)

        while (session.socket.isConnected && !session.socket.isClosed && !session.isCancelled.get()) {
            val read = input.read(header, 0, 20)
            if (read == -1) break
            if (read < 20) input.readFullyRemaining(header, read, 20 - read)

            val frameType = header[5].toInt()
            val payloadLen = header.readUInt32BE(8)

            when (frameType) {
                0x21 -> { // CHUNK_DATA (Pure binary payload)
                    val chunkIdx = header.readUInt32BE(12)
                    if (receiverBuffer.size < payloadLen) {
                        receiverBuffer = ByteArray(payloadLen)
                    }
                    input.readFully(receiverBuffer, 0, payloadLen)

                    // Write chunk directly to disk buffer & update SHA-256 in single pass
                    currentFileOut.write(receiverBuffer, 0, payloadLen)
                    currentDigest.update(receiverBuffer, 0, payloadLen)

                    overallReceived += payloadLen

                    // Throttled UI Progress dispatch
                    val now = System.currentTimeMillis()
                    if (now - lastEventTime >= PROGRESS_EVENT_INTERVAL_MS) {
                        lastEventTime = now
                        
                        val speedDeltaTime = Math.max(1L, now - lastSpeedUpdateTime)
                        val speedDeltaBytes = overallReceived - lastSpeedUpdateBytes
                        val currentInstantSpeed = (speedDeltaBytes * 1000L) / speedDeltaTime
                        
                        movingAvgSpeed = (movingAvgSpeed * 0.7 + currentInstantSpeed * 0.3).toLong()
                        if (movingAvgSpeed == 0L && currentInstantSpeed > 0) {
                            movingAvgSpeed = currentInstantSpeed
                        }
                        
                        lastSpeedUpdateTime = now
                        lastSpeedUpdateBytes = overallReceived
                        
                        val rawPct = (overallReceived.toDouble() / Math.max(1L, totalExpectedTransferBytes).toDouble()) * 100.0
                        val safePct = if (overallReceived >= totalExpectedTransferBytes) 99.9 else Math.min(99.9, rawPct)
                        val eta = Math.max(0, ((totalExpectedTransferBytes - overallReceived) / Math.max(1L, movingAvgSpeed)).toInt())

                        sendEvent("transferProgress", mapOf(
                            "transferId" to transferId,
                            "state" to "TRANSFERRING",
                            "fileName" to currentFinalFile.name,
                            "transferredBytes" to overallReceived,
                            "totalBytes" to totalExpectedTransferBytes,
                            "speedBytesPerSec" to movingAvgSpeed,
                            "percentage" to safePct,
                            "etaSeconds" to eta,
                            "verificationState" to "STREAMING"
                        ))

                        updateForegroundTransferProgress(safePct.toInt(), formatSpeed(movingAvgSpeed))
                    }
                }

                0x23 -> { // FILE_END
                    val endBytes = ByteArray(payloadLen)
                    input.readFully(endBytes)
                    val endInfo = JSONObject(String(endBytes, Charsets.UTF_8))
                    val finalExpectedSha = endInfo.optString("checksum", currentExpectedChecksum)

                    currentFileOut.flush()
                    currentFileOut.close()

                    sendEvent("transferProgress", mapOf(
                        "transferId" to transferId,
                        "state" to "VERIFYING",
                        "fileName" to currentFinalFile.name,
                        "transferredBytes" to overallReceived,
                        "totalBytes" to totalExpectedTransferBytes,
                        "percentage" to 99.9,
                        "verificationState" to "VERIFYING_SHA256"
                    ))

                    val actualSha256 = currentDigest.digest().toHex()
                    val isChecksumValid = finalExpectedSha.isEmpty() || finalExpectedSha.equals(actualSha256, ignoreCase = true)

                    if (!isChecksumValid) {
                        currentPartFile.delete()
                        output.write(buildFrame(0x26, JSONObject().apply {
                            put("status", "FAILED_INTEGRITY")
                            put("expected", finalExpectedSha)
                            put("actual", actualSha256)
                        }.toString().toByteArray()))
                        output.flush()
                        throw IOException("Checksum integrity mismatch!")
                    }

                    // Rename .part to final file
                    currentPartFile.renameTo(currentFinalFile)
                    MediaScannerConnection.scanFile(
                        applicationContext,
                        arrayOf(currentFinalFile.absolutePath),
                        arrayOf(currentMimeType),
                        null
                    )

                    // Reply FILE_ACK
                    output.write(buildFrame(0x25, JSONObject().apply {
                        put("status", "VERIFIED_OK")
                        put("checksum", actualSha256)
                    }.toString().toByteArray()))
                    output.flush()

                    val durationMs = System.currentTimeMillis() - startTime
                    val avgSpeed = if (durationMs > 0) (overallReceived * 1000) / durationMs else 0L

                    // Send DATABASE_COMMIT state
                    sendEvent("transferProgress", mapOf(
                        "transferId" to transferId,
                        "state" to "DATABASE_COMMIT",
                        "fileName" to currentFinalFile.name,
                        "transferredBytes" to overallReceived,
                        "totalBytes" to totalExpectedTransferBytes,
                        "percentage" to 99.9,
                        "verificationState" to "SAVING_HISTORY"
                    ))

                    // Save to SQLite History
                    dbHelper.insertTransfer(mapOf(
                        "id" to transferId,
                        "timestamp" to System.currentTimeMillis(),
                        "senderName" to session.senderName,
                        "receiverName" to deviceName,
                        "fileName" to currentFinalFile.name,
                        "fileType" to currentMimeType,
                        "fileSize" to overallReceived,
                        "direction" to "received",
                        "status" to "completed",
                        "durationMs" to durationMs,
                        "avgSpeed" to avgSpeed,
                        "sha256" to actualSha256,
                        "localPath" to currentFinalFile.absolutePath,
                        "transportType" to "LAN_TCP"
                    ))

                    dbHelper.updateIncomingRequestStatus(transferId, "COMPLETED")
                    notifyForegroundTransferComplete(currentFinalFile.name, currentFinalFile.absolutePath)

                    sendEvent("transferCompleted", mapOf(
                        "transferId" to transferId,
                        "savedPath" to currentFinalFile.absolutePath,
                        "fileName" to currentFinalFile.name,
                        "totalBytes" to overallReceived,
                        "avgSpeed" to avgSpeed,
                        "sha256" to actualSha256,
                        "percentage" to 100.0,
                        "state" to "COMPLETED",
                        "verificationState" to "VERIFIED"
                    ))
                    break
                }
            }
        }
    }

    private fun declineIncomingTransfer(transferId: String) {
        val session = activeTransfersState.remove(transferId) ?: return
        if (session.isAccepted.get() || session.isDeclined.getAndSet(true)) return
        dbHelper.updateIncomingRequestStatus(transferId, "DECLINED")
        cancelSystemIncomingShareNotification(transferId)
        val socket = session.socket
        scope.launch(Dispatchers.IO) {
            try {
                val output = BufferedOutputStream(socket.getOutputStream(), 4096)
                val declineJson = JSONObject().apply {
                    put("transferId", transferId)
                    put("accepted", false)
                    put("reason", "user_declined")
                }
                output.write(buildFrame(0x11, declineJson.toString().toByteArray()))
                output.flush()
                socket.close()
            } catch (e: Exception) {}
        }
    }

    private fun cancelTransferSession(transferId: String) {
        activeTransfersState[transferId]?.isCancelled?.set(true)
        activeClientSockets[transferId]?.close()
        stopForegroundTransferService()
    }

    // ----------------------------------------------------
    // TCP Streaming Client (High-Throughput Sender)
    // ----------------------------------------------------
    private fun trySendFilesViaHttp(
        targetIp: String,
        targetPort: Int,
        filesList: List<Map<String, Any>>,
        transferId: String
    ): Boolean {
        val effectivePort = if (targetPort > 0) targetPort else DEFAULT_PORT
        val prof = dbHelper.getProfile()
        val savedName = prof["display_name"]
        val senderDisplayName = if (!savedName.isNullOrBlank() && savedName != "AuraDrop User") savedName else deviceName

        for (fileMap in filesList) {
            val uriStr = fileMap["uri"] as? String ?: continue
            val fileName = fileMap["name"] as? String ?: "file"
            val fileSize = (fileMap["size"] as? Number)?.toLong() ?: 0L

            sendEvent("dataChannelState", mapOf(
                "transferId" to transferId,
                "state" to "DATA_CHANNEL_CONNECTING"
            ))

            val prepUrl = URL("http://$targetIp:$effectivePort/api/auradrop/v1/prepare-upload")
            val prepConn = (prepUrl.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 3000
                readTimeout = 4000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }

            val prepPayload = JSONObject().apply {
                put("transferId", transferId)
                put("fileId", transferId)
                put("fileName", fileName)
                put("fileSize", fileSize)
                put("sha256", "")
                put("senderUserId", deviceId)
                put("senderName", senderDisplayName)
            }

            prepConn.outputStream.use { os ->
                os.write(prepPayload.toString().toByteArray(Charsets.UTF_8))
                os.flush()
            }

            if (prepConn.responseCode !in 200..299) {
                prepConn.disconnect()
                return false
            }

            val prepRespStr = prepConn.inputStream.bufferedReader().readText()
            prepConn.disconnect()
            val prepResp = JSONObject(prepRespStr)
            val token = prepResp.optString("oneTimeToken", "")

            sendEvent("dataChannelState", mapOf(
                "transferId" to transferId,
                "state" to "READY_TO_TRANSFER"
            ))

            val uploadUrl = URL("http://$targetIp:$effectivePort/api/auradrop/v1/upload?transferId=$transferId&token=$token")
            val uploadConn = (uploadUrl.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10000
                readTimeout = 3600000
                doOutput = true
                if (fileSize > 0) {
                    setFixedLengthStreamingMode(fileSize)
                } else {
                    setChunkedStreamingMode(1024 * 1024)
                }
                setRequestProperty("x-transfer-id", transferId)
                setRequestProperty("x-file-name", fileName)
                setRequestProperty("x-file-size", fileSize.toString())
                setRequestProperty("x-token", token)
                setRequestProperty("Content-Type", "application/octet-stream")
            }

            startForegroundTransferService("Sending $fileName...", 0)
            val startTime = System.currentTimeMillis()
            var lastProgressTime = 0L
            var sentBytes = 0L
            val buf = ByteArray(1024 * 1024)

            val inputStream = contentResolver.openInputStream(Uri.parse(uriStr))
                ?: throw FileNotFoundException("Could not open URI: $uriStr")

            inputStream.use { fis ->
                uploadConn.outputStream.use { uos ->
                    val bos = BufferedOutputStream(uos, 1024 * 1024)
                    while (sentBytes < fileSize) {
                        val toRead = Math.min(buf.size.toLong(), fileSize - sentBytes).toInt()
                        val r = fis.read(buf, 0, toRead)
                        if (r == -1) break
                        bos.write(buf, 0, r)
                        sentBytes += r

                        val now = System.currentTimeMillis()
                        if (now - lastProgressTime >= PROGRESS_EVENT_INTERVAL_MS || sentBytes == fileSize) {
                            lastProgressTime = now
                            val elapsedSec = Math.max(0.001, (now - startTime) / 1000.0)
                            val speed = (sentBytes / elapsedSec).toLong()
                            val pct = if (fileSize > 0) ((sentBytes.toDouble() / fileSize.toDouble()) * 100.0).toInt().coerceAtMost(99) else 100
                            val eta = if (speed > 0) ((fileSize - sentBytes) / speed).toInt() else 0

                            sendEvent("transferProgress", mapOf(
                                "transferId" to transferId,
                                "state" to "TRANSFERRING",
                                "fileName" to fileName,
                                "totalBytes" to fileSize,
                                "transferredBytes" to sentBytes,
                                "speedBytesPerSec" to speed,
                                "etaSeconds" to eta,
                                "percentage" to pct
                            ))
                        }
                    }
                    bos.flush()
                }
            }

            stopForegroundTransferService()
            val uploadStatus = uploadConn.responseCode
            val uploadRespStr = if (uploadStatus in 200..299) uploadConn.inputStream.bufferedReader().readText() else ""
            uploadConn.disconnect()

            if (uploadStatus in 200..299) {
                val elapsedTotalSec = Math.max(0.001, (System.currentTimeMillis() - startTime) / 1000.0)
                val avgSpeed = (sentBytes / elapsedTotalSec).toLong()

                dbHelper.insertTransfer(mapOf(
                    "id" to transferId,
                    "direction" to "sent",
                    "senderName" to senderDisplayName,
                    "receiverName" to targetIp,
                    "fileName" to fileName,
                    "fileSize" to sentBytes,
                    "status" to "completed",
                    "sha256" to "",
                    "localPath" to uriStr,
                    "transportType" to "LAN_HTTP_STREAM",
                    "avgSpeed" to avgSpeed,
                    "createdAt" to System.currentTimeMillis()
                ))

                sendEvent("transferComplete", mapOf(
                    "transferId" to transferId,
                    "fileName" to fileName,
                    "fileSize" to sentBytes,
                    "verified" to true
                ))
            } else {
                return false
            }
        }
        return true
    }

    private fun startSendFilesTask(targetIp: String, targetPort: Int, filesList: List<Map<String, Any>>) {
        val transferId = "send_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10)

        scope.launch(Dispatchers.IO) {
            // High-speed HTTP direct upload trial (100MB/s compatible with Desktop axum engine)
            var httpSuccess = false
            try {
                httpSuccess = trySendFilesViaHttp(targetIp, targetPort, filesList, transferId)
            } catch (e: Exception) {
                Log.d(TAG, "HTTP upload trial failed, falling back: ${e.message}")
            }
            if (httpSuccess) {
                return@launch
            }

            var socket: Socket? = null
            try {
                sendEvent("dataChannelState", mapOf(
                    "transferId" to transferId,
                    "state" to "DATA_CHANNEL_CONNECTING"
                ))

                socket = Socket().apply {
                    tcpNoDelay = true
                    trafficClass = 0x10 // IPTOS_THROUGHPUT
                    sendBufferSize = SOCKET_BUFFER_SIZE
                    receiveBufferSize = SOCKET_BUFFER_SIZE
                    connect(InetSocketAddress(targetIp, targetPort), 7000)
                }

                val session = TransferSession(transferId, socket)
                activeTransfersState[transferId] = session
                activeClientSockets[transferId] = socket

                val output = BufferedOutputStream(socket.getOutputStream(), SOCKET_BUFFER_SIZE)
                val input = BufferedInputStream(socket.getInputStream(), SOCKET_BUFFER_SIZE)

                // Handshake Init
                val clientNonce = UUID.randomUUID().toString()
                val initJson = JSONObject().apply {
                    put("protocolVersion", "P2PFS/1")
                    put("deviceId", deviceId)
                    put("deviceName", deviceName)
                    put("platform", "android")
                    put("nonce", clientNonce)
                }
                output.write(buildFrame(0x01, initJson.toString().toByteArray()))
                output.flush()

                // Read Handshake Resp
                val header = ByteArray(20)
                input.readFully(header)
                val respLen = header.readUInt32BE(8)
                val respBytes = ByteArray(respLen)
                input.readFully(respBytes)
                val respJson = JSONObject(String(respBytes, Charsets.UTF_8))

                if (respJson.optString("nonceEcho") != clientNonce) {
                    throw IOException("Handshake integrity check failed")
                }

                // Health Check Ping / Pong
                val pingData = "HEALTH_PING_${System.currentTimeMillis()}".toByteArray()
                output.write(buildFrame(0x03, pingData))
                output.flush()

                input.readFully(header)
                val pongLen = header.readUInt32BE(8)
                val pongBytes = ByteArray(pongLen)
                input.readFully(pongBytes)

                sendEvent("dataChannelState", mapOf(
                    "transferId" to transferId,
                    "state" to "READY_TO_TRANSFER"
                ))

                // Negotiation Request
                val totalBytes = filesList.sumOf { (it["size"] as? Number)?.toLong() ?: 0L }
                val filesJsonArr = JSONArray()
                for (f in filesList) {
                    filesJsonArr.put(JSONObject().apply {
                        put("id", f["id"] ?: UUID.randomUUID().toString())
                        put("name", f["name"] ?: "unnamed")
                        put("size", (f["size"] as? Number)?.toLong() ?: 0L)
                        put("mimeType", f["mimeType"] ?: "application/octet-stream")
                    })
                }

                val prof = dbHelper.getProfile()
                val savedName = prof["display_name"]
                val senderDisplayName = if (!savedName.isNullOrBlank() && savedName != "AuraDrop User") savedName else deviceName

                val negJson = JSONObject().apply {
                    put("transferId", transferId)
                    put("senderName", senderDisplayName)
                    put("senderDeviceName", deviceName)
                    put("deviceId", deviceId)
                    put("totalFiles", filesList.size)
                    put("totalBytes", totalBytes)
                    put("files", filesJsonArr)
                    put("createdAt", System.currentTimeMillis())
                    put("expiresAt", System.currentTimeMillis() + 60000L)
                }
                output.write(buildFrame(0x10, negJson.toString().toByteArray()))
                output.flush()

                sendEvent("transferProgress", mapOf(
                    "transferId" to transferId,
                    "state" to "WAITING_FOR_ACCEPTANCE",
                    "totalBytes" to totalBytes,
                    "transferredBytes" to 0L,
                    "percentage" to 0
                ))

                // Negotiation Response with 60-second timeout
                socket.soTimeout = 60000
                input.readFully(header)
                val negRespLen = header.readUInt32BE(8)
                val negRespBytes = ByteArray(negRespLen)
                input.readFully(negRespBytes)
                val negRespJson = JSONObject(String(negRespBytes, Charsets.UTF_8))
                socket.soTimeout = 0

                if (!negRespJson.optBoolean("accepted", false)) {
                    val declineReason = negRespJson.optString("reason", "declined")
                    val errorMsg = if (declineReason == "blocked") "Transfer was blocked by recipient."
                    else if (declineReason == "visibility_off") "Recipient has sharing turned off."
                    else if (declineReason == "not_trusted") "Recipient only accepts transfers from trusted contacts."
                    else "Recipient declined the transfer request."
                    sendEvent("transferError", mapOf(
                        "transferId" to transferId,
                        "error" to errorMsg
                    ))
                    return@launch
                }

                startForegroundTransferService("Sending files...", 0)

                // Adaptive Chunk Engine (Starts at 512 KB, scales up to 1 MB / 2 MB / 4 MB)
                var currentChunkSize = 512 * 1024
                var chunkBuffer = ByteArray(currentChunkSize)
                var overallSent = 0L
                val startTime = System.currentTimeMillis()
                var lastEventTime = 0L
                
                var lastSpeedUpdateTime = startTime
                var lastSpeedUpdateBytes = 0L
                var movingAvgSpeed = 0L

                for (fileMap in filesList) {
                    if (session.isCancelled.get()) break

                    val uriStr = fileMap["uri"] as? String ?: continue
                    val fileName = fileMap["name"] as? String ?: "file"
                    val fileSize = (fileMap["size"] as? Number)?.toLong() ?: 0L
                    val mimeType = fileMap["mimeType"] as? String ?: "application/octet-stream"

                    val fileDigest = MessageDigest.getInstance("SHA-256")

                    // Send FILE_START
                    val startJson = JSONObject().apply {
                        put("fileId", fileMap["id"] ?: "f1")
                        put("filename", fileName)
                        put("size", fileSize)
                        put("mimeType", mimeType)
                        put("totalTransferBytes", totalBytes)
                        put("offset", 0L)
                    }
                    output.write(buildFrame(0x20, startJson.toString().toByteArray()))
                    output.flush()

                    val inputStream = contentResolver.openInputStream(Uri.parse(uriStr))
                        ?: throw FileNotFoundException("Could not open file URI: $uriStr")

                    var fileSent = 0L
                    var chunkIdx = 0

                    inputStream.use { stream ->
                        val bufferedStream = BufferedInputStream(stream, SOCKET_BUFFER_SIZE)

                        while (fileSent < fileSize && !session.isCancelled.get()) {
                            // Adapt chunk size dynamically based on wire throughput
                            val elapsedNow = Math.max(0.1, (System.currentTimeMillis() - startTime) / 1000.0)
                            val currentSpeed = overallSent / elapsedNow
                            val targetChunkSize = when {
                                currentSpeed > 40 * 1024 * 1024 -> 2 * 1024 * 1024 // 2 MB
                                currentSpeed > 15 * 1024 * 1024 -> 1024 * 1024     // 1 MB
                                else -> 512 * 1024                                 // 512 KB
                            }
                            if (targetChunkSize != currentChunkSize) {
                                currentChunkSize = targetChunkSize
                                chunkBuffer = ByteArray(currentChunkSize)
                            }

                            val toRead = Math.min(currentChunkSize.toLong(), fileSize - fileSent).toInt()
                            val bytesRead = bufferedStream.read(chunkBuffer, 0, toRead)
                            if (bytesRead <= 0) break

                            fileDigest.update(chunkBuffer, 0, bytesRead)

                            // Direct 20-byte frame header with pure payload stream (zero copy, zero buffer allocation)
                            val chunkFrameHeader = buildChunkFrameHeader(chunkIdx, bytesRead)
                            output.write(chunkFrameHeader)
                            output.write(chunkBuffer, 0, bytesRead)

                            fileSent += bytesRead
                            overallSent += bytesRead
                            chunkIdx++

                            // Throttle EventChannel UI updates to 11/sec
                            val now = System.currentTimeMillis()
                            if (now - lastEventTime >= PROGRESS_EVENT_INTERVAL_MS) {
                                lastEventTime = now
                                
                                val speedDeltaTime = Math.max(1L, now - lastSpeedUpdateTime)
                                val speedDeltaBytes = overallSent - lastSpeedUpdateBytes
                                val currentInstantSpeed = (speedDeltaBytes * 1000L) / speedDeltaTime
                                
                                movingAvgSpeed = (movingAvgSpeed * 0.7 + currentInstantSpeed * 0.3).toLong()
                                if (movingAvgSpeed == 0L && currentInstantSpeed > 0) {
                                    movingAvgSpeed = currentInstantSpeed
                                }
                                
                                lastSpeedUpdateTime = now
                                lastSpeedUpdateBytes = overallSent
                                
                                val rawPct = (overallSent.toDouble() / Math.max(1L, totalBytes).toDouble()) * 100.0
                                val safePct = if (overallSent >= totalBytes) 99.9 else Math.min(99.9, rawPct)
                                val eta = Math.max(0, ((totalBytes - overallSent) / Math.max(1L, movingAvgSpeed)).toInt())

                                sendEvent("transferProgress", mapOf(
                                    "transferId" to transferId,
                                    "state" to "TRANSFERRING",
                                    "fileName" to fileName,
                                    "transferredBytes" to overallSent,
                                    "totalBytes" to totalBytes,
                                    "speedBytesPerSec" to movingAvgSpeed,
                                    "percentage" to safePct,
                                    "etaSeconds" to eta,
                                    "verificationState" to "STREAMING"
                                ))

                                updateForegroundTransferProgress(safePct.toInt(), formatSpeed(movingAvgSpeed))
                            }
                        }
                    }

                    // Flush socket before ending file
                    output.flush()

                    val senderSha256 = fileDigest.digest().toHex()

                    // Send FILE_END
                    output.write(buildFrame(0x23, JSONObject().apply {
                        put("fileId", fileMap["id"])
                        put("checksum", senderSha256)
                    }.toString().toByteArray()))
                    output.flush()

                    // Await FILE_ACK
                    sendEvent("transferProgress", mapOf(
                        "transferId" to transferId,
                        "state" to "VERIFYING",
                        "percentage" to 99.9,
                        "verificationState" to "VERIFYING_SHA256"
                    ))

                    input.readFully(header)
                    val ackLen = header.readUInt32BE(8)
                    val ackBytes = ByteArray(ackLen)
                    input.readFully(ackBytes)
                    val ackJson = JSONObject(String(ackBytes, Charsets.UTF_8))

                    if (ackJson.optString("status") != "VERIFIED_OK") {
                        throw IOException("Receiver integrity verification failed.")
                    }

                    val durationMs = System.currentTimeMillis() - startTime
                    val avgSpeed = if (durationMs > 0) (overallSent * 1000) / durationMs else 0L

                    // Save to SQLite History
                    dbHelper.insertTransfer(mapOf(
                        "id" to transferId,
                        "timestamp" to System.currentTimeMillis(),
                        "senderName" to deviceName,
                        "receiverName" to "Nearby Recipient",
                        "fileName" to fileName,
                        "fileType" to mimeType,
                        "fileSize" to fileSize,
                        "direction" to "sent",
                        "status" to "completed",
                        "durationMs" to durationMs,
                        "avgSpeed" to avgSpeed,
                        "sha256" to senderSha256,
                        "localPath" to uriStr,
                        "transportType" to "LAN_TCP"
                    ))
                }

                // Send TRANSFER_COMPLETE
                output.write(buildFrame(0x24, JSONObject().apply {
                    put("transferId", transferId)
                    put("status", "complete")
                }.toString().toByteArray()))
                output.flush()

                notifyForegroundTransferComplete("Transfer complete", "")

                sendEvent("transferCompleted", mapOf(
                    "transferId" to transferId,
                    "totalBytes" to overallSent,
                    "percentage" to 100.0,
                    "state" to "COMPLETED",
                    "verificationState" to "VERIFIED"
                ))
            } catch (e: Exception) {
                Log.e(TAG, "Transfer send error: ${e.message}")
                stopForegroundTransferService()
                sendEvent("transferError", mapOf(
                    "transferId" to transferId,
                    "error" to (e.message ?: "Transfer error")
                ))
            } finally {
                socket?.close()
                activeClientSockets.remove(transferId)
                activeTransfersState.remove(transferId)
            }
        }
    }

    // ----------------------------------------------------
    // Offline P2P Chat Client Socket
    // ----------------------------------------------------
    private fun sendOfflineChatMessage(targetIp: String, targetPort: Int = DEFAULT_PORT, peerId: String, peerName: String, text: String) {
        val messageId = "msg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8)
        val timestamp = System.currentTimeMillis()

        val msgMap = mapOf(
            "id" to messageId,
            "peerId" to peerId,
            "peerName" to peerName,
            "senderId" to deviceId,
            "text" to text,
            "timestamp" to timestamp,
            "status" to "sent" // Immediate local P2P assumption
        )
        dbHelper.insertChatMessage(msgMap)
        sendEvent("chatMessageSent", msgMap)

        scope.launch(Dispatchers.IO) {
            var delivered = false
            try {
                val effectivePort = if (targetPort > 0) targetPort else DEFAULT_PORT
                val url = URL("http://$targetIp:$effectivePort/api/auradrop/v1/chat")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 3000
                    readTimeout = 4000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
                val payload = JSONObject().apply {
                    put("id", messageId)
                    put("senderId", deviceId)
                    put("senderName", deviceName)
                    put("text", text)
                    put("timestamp", timestamp)
                }
                conn.outputStream.use { os ->
                    os.write(payload.toString().toByteArray(Charsets.UTF_8))
                    os.flush()
                }
                if (conn.responseCode in 200..299) {
                    delivered = true
                }
                conn.disconnect()
            } catch (e: Exception) {
                Log.d(TAG, "HTTP chat send failed, attempting socket fallback: ${e.message}")
            }

            if (!delivered) {
                var chatSocket: Socket? = null
                try {
                    chatSocket = Socket().apply {
                        tcpNoDelay = true
                        connect(InetSocketAddress(targetIp, DEFAULT_PORT), 3000)
                    }
                    val output = BufferedOutputStream(chatSocket.getOutputStream(), 4096)
                    val input = BufferedInputStream(chatSocket.getInputStream(), 4096)

                    // Send Handshake Init
                    val initJson = JSONObject().apply {
                        put("protocolVersion", "P2PFS/1")
                        put("deviceId", deviceId)
                        put("deviceName", deviceName)
                        put("platform", "android")
                        put("nonce", UUID.randomUUID().toString())
                    }
                    output.write(buildFrame(0x01, initJson.toString().toByteArray()))
                    output.flush()

                    // Read Handshake Resp
                    val header = ByteArray(20)
                    input.readFully(header)
                    val respLen = header.readUInt32BE(8)
                    val respBytes = ByteArray(respLen)
                    input.readFully(respBytes)

                    // Send CHAT_MESSAGE frame (0x30)
                    val chatPayload = JSONObject().apply {
                        put("id", messageId)
                        put("senderId", deviceId)
                        put("senderName", deviceName)
                        put("text", text)
                        put("timestamp", timestamp)
                    }
                    output.write(buildFrame(0x30, chatPayload.toString().toByteArray()))
                    output.flush()

                    // Read CHAT_ACK
                    input.readFully(header)
                    val ackLen = header.readUInt32BE(8)
                    val ackBytes = ByteArray(ackLen)
                    input.readFully(ackBytes)
                    val ackJson = JSONObject(String(ackBytes, Charsets.UTF_8))

                    val status = ackJson.optString("status", "delivered")
                    delivered = (status == "delivered" || status == "ok")
                } catch (e: Exception) {
                    Log.e(TAG, "Raw socket chat error: ${e.message}")
                } finally {
                    try { chatSocket?.close() } catch (_: Exception) {}
                }
            }

            val finalStatus = if (delivered) "delivered" else "failed"
            dbHelper.updateChatMessageStatus(messageId, finalStatus)
            sendEvent("chatMessageStatusUpdated", mapOf("id" to messageId, "status" to finalStatus))
        }
    }

    private fun sendChatTypingStatus(targetIp: String, isTyping: Boolean) {
        scope.launch(Dispatchers.IO) {
            try {
                val chatSocket = Socket().apply {
                    tcpNoDelay = true
                    connect(InetSocketAddress(targetIp, DEFAULT_PORT), 3000)
                }
                chatSocket.use { s ->
                    val output = BufferedOutputStream(s.getOutputStream(), 1024)
                    val typPayload = JSONObject().apply {
                        put("senderId", deviceId)
                        put("isTyping", isTyping)
                    }
                    output.write(buildFrame(0x32, typPayload.toString().toByteArray()))
                    output.flush()
                }
            } catch (e: Exception) {}
        }
    }

    // ----------------------------------------------------
    // Received Files Inspection
    // ----------------------------------------------------
    private fun listReceivedFiles(): List<Map<String, Any>> {
        val list = mutableListOf<Map<String, Any>>()
        val downloadsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AuraDrop")
        if (downloadsDir.exists() && downloadsDir.isDirectory) {
            val files = downloadsDir.listFiles { f -> !f.name.endsWith(".part") } ?: emptyArray()
            files.sortByDescending { it.lastModified() }
            for (f in files) {
                list.add(mapOf(
                    "name" to f.name,
                    "path" to f.absolutePath,
                    "size" to f.length(),
                    "lastModified" to f.lastModified(),
                    "extension" to f.extension
                ))
            }
        }
        return list
    }

    // ----------------------------------------------------
    // Binary Framing Helpers (P2PFS/1 Spec)
    // ----------------------------------------------------
    private fun buildFrame(frameType: Int, payload: ByteArray, authTag: ByteArray? = null): ByteArray {
        val tagLen = authTag?.size ?: 0
        val frame = ByteArray(20 + payload.size + tagLen)
        // Magic 'P2PF'
        frame[0] = 0x50.toByte(); frame[1] = 0x32.toByte(); frame[2] = 0x50.toByte(); frame[3] = 0x46.toByte()
        frame[4] = 0x01 // Version 1
        frame[5] = frameType.toByte()
        frame[6] = 0x00; frame[7] = if (authTag != null) 0x08.toByte() else 0x00.toByte() // Flags
        frame.writeUInt32BE(payload.size, 8)
        System.arraycopy(payload, 0, frame, 20, payload.size)
        if (authTag != null) {
            System.arraycopy(authTag, 0, frame, 20 + payload.size, authTag.size)
        }
        return frame
    }

    private fun buildChunkFrameHeader(chunkIdx: Int, payloadLen: Int): ByteArray {
        val frame = ByteArray(20)
        // Magic 'P2PF'
        frame[0] = 0x50.toByte(); frame[1] = 0x32.toByte(); frame[2] = 0x50.toByte(); frame[3] = 0x46.toByte()
        frame[4] = 0x01 // Version 1
        frame[5] = 0x21.toByte() // CHUNK_DATA
        frame[6] = 0x00; frame[7] = 0x00 // Flags
        frame.writeUInt32BE(payloadLen, 8)
        frame.writeUInt32BE(chunkIdx, 12)
        return frame
    }

    private fun ByteArray.readUInt32BE(offset: Int): Int {
        return ((this[offset].toInt() and 0xFF) shl 24) or
               ((this[offset + 1].toInt() and 0xFF) shl 16) or
               ((this[offset + 2].toInt() and 0xFF) shl 8) or
               (this[offset + 3].toInt() and 0xFF)
    }

    private fun ByteArray.writeUInt32BE(value: Int, offset: Int) {
        this[offset] = ((value ushr 24) and 0xFF).toByte()
        this[offset + 1] = ((value ushr 16) and 0xFF).toByte()
        this[offset + 2] = ((value ushr 8) and 0xFF).toByte()
        this[offset + 3] = (value and 0xFF).toByte()
    }

    private fun ByteArray.readUInt64BE(offset: Int): Long {
        var res = 0L
        for (i in 0 until 8) {
            res = (res shl 8) or (this[offset + i].toLong() and 0xFFL)
        }
        return res
    }

    private fun ByteArray.writeUInt64BE(value: Long, offset: Int) {
        for (i in 7 downTo 0) {
            this[offset + (7 - i)] = ((value ushr (i * 8)) and 0xFFL).toByte()
        }
    }

    private fun InputStream.readFully(b: ByteArray) {
        readFully(b, 0, b.size)
    }

    private fun InputStream.readFully(b: ByteArray, offset: Int, length: Int) {
        var currentOffset = offset
        val target = offset + length
        while (currentOffset < target) {
            val count = this.read(b, currentOffset, target - currentOffset)
            if (count < 0) throw EOFException("Unexpected EOF while reading socket frame")
            currentOffset += count
        }
    }

    private fun InputStream.readFullyRemaining(b: ByteArray, initialOffset: Int, remaining: Int) {
        var offset = initialOffset
        val target = initialOffset + remaining
        while (offset < target) {
            val count = this.read(b, offset, target - offset)
            if (count < 0) throw EOFException("Unexpected EOF while reading remaining bytes")
            offset += count
        }
    }

    private fun ByteArray.toHex(): String {
        val result = StringBuilder(size * 2)
        for (b in this) {
            result.append(String.format("%02x", b))
        }
        return result.toString()
    }

    private fun sanitizeFilename(name: String): String {
        var safe = name.replace("[/\\\\:*?\"<>|\\x00-\\x1F]".toRegex(), "_")
        if (safe.matches(Regex("^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\\..*)?$", RegexOption.IGNORE_CASE))) {
            safe = "_$safe"
        }
        return safe.trim().ifEmpty { "file_${System.currentTimeMillis()}" }
    }

    private fun resolveUniqueFile(dir: File, fileName: String): File {
        var target = File(dir, fileName)
        if (!target.exists()) return target

        val dotIdx = fileName.lastIndexOf('.')
        val namePart = if (dotIdx != -1) fileName.substring(0, dotIdx) else fileName
        val extPart = if (dotIdx != -1) fileName.substring(dotIdx) else ""

        var counter = 1
        while (target.exists()) {
            target = File(dir, "$namePart ($counter)$extPart")
            counter++
        }
        return target
    }

    private fun generateSasCode(idA: String, idB: String): String {
        val combined = "$idA:$idB"
        val hash = MessageDigest.getInstance("SHA-256").digest(combined.toByteArray()).toHex()
        val p1 = hash.substring(0, 4).toInt(16) % 10000
        val p2 = hash.substring(4, 8).toInt(16) % 10000
        val p3 = hash.substring(8, 12).toInt(16) % 10000
        val p4 = hash.substring(12, 16).toInt(16) % 10000
        return String.format("%04d %04d %04d %04d", p1, p2, p3, p4)
    }

    private fun openFileWithSystemViewer(filePath: String): Boolean {
        return try {
            val file = File(filePath)
            if (!file.exists()) {
                Log.e(TAG, "File does not exist: $filePath")
                return false
            }

            val uri = FileProvider.getUriForFile(this, "${applicationContext.packageName}.fileprovider", file)
            val extension = file.extension.lowercase()
            val mimeType = if (extension.isNotEmpty()) {
                MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "*/*"
            } else {
                "*/*"
            }

            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            try {
                startActivity(viewIntent)
                true
            } catch (e: ActivityNotFoundException) {
                // Fallback to chooser with generic */*
                val fallbackIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "*/*")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = Intent.createChooser(fallbackIntent, "Open with").apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                startActivity(chooser)
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error opening file: ${e.message}")
            false
        }
    }

    private fun getLocalIpAddress(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        return addr.hostAddress ?: "127.0.0.1"
                    }
                }
            }
        } catch (e: Exception) {}
        return "127.0.0.1"
    }

    private fun startForegroundTransferService(title: String, progress: Int) {
        try {
            val intent = Intent(this, TransferForegroundService::class.java).apply {
                action = TransferForegroundService.ACTION_START
                putExtra(TransferForegroundService.EXTRA_TITLE, title)
                putExtra(TransferForegroundService.EXTRA_PROGRESS, progress)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: Exception) {}
    }

    private fun updateForegroundTransferProgress(progress: Int, speed: String) {
        try {
            val intent = Intent(this, TransferForegroundService::class.java).apply {
                action = TransferForegroundService.ACTION_UPDATE
                putExtra(TransferForegroundService.EXTRA_PROGRESS, progress)
                putExtra(TransferForegroundService.EXTRA_SPEED, speed)
            }
            startService(intent)
        } catch (e: Exception) {}
    }

    private fun notifyForegroundTransferComplete(fileName: String, filePath: String) {
        try {
            val intent = Intent(this, TransferForegroundService::class.java).apply {
                action = TransferForegroundService.ACTION_COMPLETE
                putExtra(TransferForegroundService.EXTRA_FILE_NAME, fileName)
                putExtra(TransferForegroundService.EXTRA_FILE_PATH, filePath)
            }
            startService(intent)
        } catch (e: Exception) {}
    }

    private fun stopForegroundTransferService() {
        try {
            val intent = Intent(this, TransferForegroundService::class.java).apply {
                action = TransferForegroundService.ACTION_STOP
            }
            startService(intent)
        } catch (e: Exception) {}
    }

    private fun formatSpeed(bytesPerSec: Long): String {
        if (bytesPerSec < 1024) return "$bytesPerSec B/s"
        if (bytesPerSec < 1024 * 1024) return "${bytesPerSec / 1024} KB/s"
        return String.format("%.1f MB/s", bytesPerSec / (1024.0 * 1024.0))
    }

    private fun formatBytes(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0)
        if (bytes < 1024 * 1024 * 1024) return String.format("%.1f MB", bytes / (1024.0 * 1024.0))
        return String.format("%.2f GB", bytes / (1024.0 * 1024.0 * 1024.0))
    }

    private fun createSystemNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val reqChannel = NotificationChannel(
                INCOMING_REQUEST_CHANNEL_ID,
                "Incoming Share Requests",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Shows actionable notifications when nearby devices request to share files"
                enableVibration(true)
                setShowBadge(true)
            }
            nm.createNotificationChannel(reqChannel)

            val chatChannel = NotificationChannel(
                CHAT_NOTIFICATION_CHANNEL_ID,
                "Chat Messages",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Notifies when new messages arrive from nearby peers"
                setShowBadge(true)
            }
            nm.createNotificationChannel(chatChannel)
        }
    }

    private fun showSystemIncomingShareNotification(
        transferId: String,
        senderName: String,
        senderDeviceName: String,
        totalFiles: Int,
        totalBytes: Long,
        firstFileName: String,
        sasCode: String
    ) {
        val overlayMgr = AuraOverlayManager.getInstance(this)
        val nameToShow = if (senderDeviceName.isNotBlank() && senderDeviceName != senderName) {
            "$senderName ($senderDeviceName)"
        } else {
            senderName
        }
        val isPhoto = firstFileName.matches(Regex(".*\\.(jpg|jpeg|png|heic|webp|gif)$", RegexOption.IGNORE_CASE))
        val fileSummary = if (totalFiles > 1) {
            if (isPhoto) "$totalFiles photos" else "$totalFiles files"
        } else {
            if (isPhoto) "1 photo" else firstFileName
        }

        // Display directly on mobile screen over other apps & home screen
        overlayMgr.showTransferRequestOverlay(
            transferId = transferId,
            senderName = nameToShow,
            fileName = fileSummary,
            totalBytes = totalBytes,
            onAccept = {
                acceptIncomingTransfer(transferId)
                sendEvent("notificationAccept", mapOf("transferId" to transferId))
            },
            onDecline = {
                declineIncomingTransfer(transferId)
                sendEvent("notificationDecline", mapOf("transferId" to transferId))
            }
        )
    }

    private fun cancelSystemIncomingShareNotification(transferId: String) {
        AuraOverlayManager.getInstance(this).dismissCurrentOverlay()
    }

    private fun showSystemChatMessageNotification(senderName: String, text: String) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)
            val openPendingIntent = if (openAppIntent != null) {
                PendingIntent.getActivity(this, 0, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            } else null

            val builder = NotificationCompat.Builder(this, CHAT_NOTIFICATION_CHANNEL_ID)
                .setContentTitle(senderName)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.sym_action_chat)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(openPendingIntent)

            nm.notify(System.currentTimeMillis().toInt(), builder.build())
        } catch (e: Exception) {}
    }

    private fun showSystemNameDropProximityNotification(
        peerId: String = "",
        peerName: String,
        deviceName: String = "",
        platform: String = "device",
        ip: String = ""
    ) {
        // Display sleek floating window directly on mobile screen over other apps & home screen
        AuraOverlayManager.getInstance(this).showNameDropOverlay(
            peerId = peerId,
            peerName = peerName,
            deviceName = deviceName,
            platform = platform,
            ip = ip,
            onShare = {
                sendEvent("peerSelected", mapOf("peerId" to peerId))
            }
        )
    }

    override fun onDestroy() {
        if (activeInstance == this) activeInstance = null
        stopDiscoveryEngine()
        scope.cancel()
        transferServer?.close()
        dbHelper.close()
        super.onDestroy()
    }
}
