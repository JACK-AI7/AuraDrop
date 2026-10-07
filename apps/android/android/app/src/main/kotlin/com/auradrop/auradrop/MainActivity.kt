package com.auradrop.auradrop

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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

class MainActivity : FlutterActivity() {
    companion object {
        private const val TAG = "AuraDropNative"
        private const val METHOD_CHANNEL = "com.auradrop.app/native"
        private const val EVENT_CHANNEL = "com.auradrop.app/events"
        private const val FILE_PICK_CODE = 48291
        private const val AVATAR_PICK_CODE = 48292
        private const val DEFAULT_PORT = 48291
        private const val DISCOVERY_GROUP = "239.255.48.29"
        private const val DISCOVERY_PORT = 48290
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
                } else {
                    inst.declineIncomingTransfer(transferId)
                }
            }
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(transferId.hashCode())
        }
    }

    private var eventSink: EventChannel.EventSink? = null
    private var pendingFilePickResult: MethodChannel.Result? = null
    private var pendingAvatarPickResult: MethodChannel.Result? = null
    private var isAppInForeground = true

    private var multicastLock: WifiManager.MulticastLock? = null
    private var isDiscovering = false
    private var discoveryJob: Job? = null
    private var serverJob: Job? = null
    private var transferServer: ServerSocket? = null

    // Sockets and Transfer Sessions
    private val activeClientSockets = ConcurrentHashMap<String, Socket>()
    private val activeTransfersState = ConcurrentHashMap<String, TransferSession>()
    private val activePeerChatSockets = ConcurrentHashMap<String, Socket>()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Database
    private lateinit var dbHelper: AuraDropDatabaseHelper

    private val deviceId = "android_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10)
    private var deviceName = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"

    // Initial files received from Android System Share intent
    private val sharedFilesList = Collections.synchronizedList(mutableListOf<Map<String, Any>>())

    data class TransferSession(
        val transferId: String,
        val socket: Socket,
        var isCancelled: AtomicBoolean = AtomicBoolean(false),
        var isPaused: AtomicBoolean = AtomicBoolean(false)
    )

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        activeInstance = this
        createSystemNotificationChannels()
        dbHelper = AuraDropDatabaseHelper(this)
        val profile = dbHelper.getProfile()
        if (profile.containsKey("display_name")) {
            val name = profile["display_name"]
            if (!name.isNullOrBlank()) deviceName = name
        }
        handleSendIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        isAppInForeground = true
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

        if (Intent.ACTION_SEND == action && type != null) {
            val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_STREAM)
            }
            if (uri != null) {
                getFileMeta(uri)?.let {
                    sharedFilesList.add(it)
                    sendEvent("systemShareReceived", mapOf("files" to listOf(it)))
                }
            }
        } else if (Intent.ACTION_SEND_MULTIPLE == action && type != null) {
            val uris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
            }
            if (uris != null) {
                val files = mutableListOf<Map<String, Any>>()
                for (u in uris) {
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
                // Offline P2P Chat Handlers
                "getChatMessages" -> {
                    val peerId = call.argument<String>("peerId") ?: ""
                    val msgs = dbHelper.getChatMessages(peerId)
                    result.success(msgs)
                }
                "sendChatMessage" -> {
                    val targetIp = call.argument<String>("targetIp") ?: ""
                    val peerId = call.argument<String>("peerId") ?: ""
                    val peerName = call.argument<String>("peerName") ?: "Nearby Peer"
                    val text = call.argument<String>("text") ?: ""
                    sendOfflineChatMessage(targetIp, peerId, peerName, text)
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
        return contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            cursor.moveToFirst()
            val rawName = if (nameIndex != -1) cursor.getString(nameIndex) else "unknown_file"
            val sanitizedName = sanitizeFilename(rawName)
            val size = if (sizeIndex != -1) cursor.getLong(sizeIndex) else 0L
            val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"
            mapOf(
                "id" to UUID.randomUUID().toString(),
                "name" to sanitizedName,
                "size" to size,
                "mimeType" to mimeType,
                "uri" to uri.toString()
            )
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

        discoveryJob = scope.launch {
            launch { runUdpListener() }
            launch { runUdpBroadcaster() }
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
    }

    private suspend fun runUdpBroadcaster() = withContext(Dispatchers.IO) {
        val group = InetAddress.getByName(DISCOVERY_GROUP)
        val broadcastAddr = InetAddress.getByName("255.255.255.255")
        var socket: DatagramSocket? = null
        try {
            socket = DatagramSocket()
            while (isDiscovering && isActive) {
                try {
                    val prof = dbHelper.getProfile()
                    val beacon = JSONObject().apply {
                        put("type", "AURADROP_BEACON")
                        put("protocol", "P2PFS/1")
                        put("deviceId", deviceId)
                        put("name", prof["display_name"] ?: deviceName)
                        put("deviceName", deviceName)
                        put("platform", "android")
                        put("transferPort", DEFAULT_PORT)
                        put("avatarIndex", prof["avatar_index"]?.toIntOrNull() ?: 0)
                        put("avatarPath", prof["avatar_path"] ?: "")
                        put("status", prof["bio"] ?: "Nearby sharing made effortless")
                        put("timestamp", System.currentTimeMillis())
                    }
                    val bytes = beacon.toString().toByteArray(Charsets.UTF_8)
                    socket.send(DatagramPacket(bytes, bytes.size, group, DISCOVERY_PORT))
                    socket.send(DatagramPacket(bytes, bytes.size, broadcastAddr, DISCOVERY_PORT))
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
                joinGroup(InetAddress.getByName(DISCOVERY_GROUP))
            }
            val buffer = ByteArray(4096)

            while (isDiscovering && isActive) {
                val packet = DatagramPacket(buffer, buffer.size)
                socket.receive(packet)
                val raw = String(packet.data, 0, packet.length, Charsets.UTF_8)
                try {
                    val json = JSONObject(raw)
                    val remoteDeviceId = json.optString("deviceId")
                    if (remoteDeviceId.isNotEmpty() && remoteDeviceId != deviceId) {
                        val peer = mapOf(
                            "id" to remoteDeviceId,
                            "name" to json.optString("name", "Nearby Device"),
                            "deviceName" to json.optString("deviceName", json.optString("name", "Nearby Device")),
                            "platform" to json.optString("platform", "android"),
                            "ip" to packet.address.hostAddress,
                            "port" to json.optInt("transferPort", DEFAULT_PORT),
                            "avatarIndex" to json.optInt("avatarIndex", 0),
                            "avatarPath" to json.optString("avatarPath", ""),
                            "status" to json.optString("status", "")
                        )
                        sendEvent("peerDiscovered", mapOf("peer" to peer))
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
                transferServer = ServerSocket(DEFAULT_PORT, 50).apply {
                    receiveBufferSize = SOCKET_BUFFER_SIZE
                    reuseAddress = true
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

                        val senderName = negJson.optString("senderName", "Nearby Peer")
                        val senderDeviceId = negJson.optString("deviceId", "peer")
                        val totalFiles = negJson.optInt("totalFiles", 1)
                        val totalBytes = negJson.optLong("totalBytes", 0L)
                        val filesArray = negJson.optJSONArray("files") ?: JSONArray()
                        val filesList = mutableListOf<Map<String, Any>>()

                        // Enforce Blocked Peers
                        if (dbHelper.isPeerBlocked(senderDeviceId)) {
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
                        sendEvent("transferRequest", mapOf(
                            "transferId" to transferId,
                            "senderName" to senderName,
                            "senderDeviceId" to senderDeviceId,
                            "totalFiles" to totalFiles,
                            "totalBytes" to totalBytes,
                            "sas" to sasCode,
                            "files" to filesList,
                            "resumeOffsets" to resumeOffsets.toString(),
                            "connectionState" to "WAITING_FOR_ACCEPTANCE"
                        ))

                        // System-Level Nearby Sharing Notification (Works in background per V8)
                        showSystemIncomingShareNotification(transferId, senderName, totalFiles, totalBytes, sasCode)
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

    private fun acceptIncomingTransfer(transferId: String) {
        val session = activeTransfersState[transferId] ?: return
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

        while (session.socket.isConnected && !session.socket.isClosed && !session.isCancelled.get()) {
            val read = input.read(header, 0, 20)
            if (read == -1) break
            if (read < 20) input.readFullyRemaining(header, read, 20 - read)

            val frameType = header[5].toInt()
            val payloadLen = header.readUInt32BE(8)

            when (frameType) {
                0x21 -> { // CHUNK_DATA (Direct 8-byte binary header)
                    val chunkIdx = header.readUInt32BE(12) // using sequence/meta offset
                    val chunkDataLen = payloadLen - 8
                    val chunkData = ByteArray(chunkDataLen)
                    input.readFully(chunkData)

                    // Write chunk directly to disk buffer
                    currentFileOut.write(chunkData)
                    currentDigest.update(chunkData)

                    overallReceived += chunkDataLen

                    // Throttled UI Progress dispatch
                    val now = System.currentTimeMillis()
                    if (now - lastEventTime >= PROGRESS_EVENT_INTERVAL_MS) {
                        lastEventTime = now
                        val elapsedSec = Math.max(0.1, (now - startTime) / 1000.0)
                        val speedBytesPerSec = (overallReceived / elapsedSec).toLong()
                        val rawPct = (overallReceived.toDouble() / Math.max(1L, totalExpectedTransferBytes).toDouble()) * 100.0
                        val safePct = if (overallReceived >= totalExpectedTransferBytes) 99.9 else Math.min(99.9, rawPct)
                        val eta = Math.max(0, ((totalExpectedTransferBytes - overallReceived) / Math.max(1L, speedBytesPerSec)).toInt())

                        sendEvent("transferProgress", mapOf(
                            "transferId" to transferId,
                            "state" to "TRANSFERRING",
                            "fileName" to currentFinalFile.name,
                            "transferredBytes" to overallReceived,
                            "totalBytes" to totalExpectedTransferBytes,
                            "speedBytesPerSec" to speedBytesPerSec,
                            "percentage" to safePct,
                            "etaSeconds" to eta,
                            "verificationState" to "STREAMING"
                        ))

                        updateForegroundTransferProgress(safePct.toInt(), formatSpeed(speedBytesPerSec))
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
                        "senderName" to "Nearby Device",
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
    private fun startSendFilesTask(targetIp: String, targetPort: Int, filesList: List<Map<String, Any>>) {
        val transferId = "send_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10)

        scope.launch(Dispatchers.IO) {
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

                val negJson = JSONObject().apply {
                    put("transferId", transferId)
                    put("senderName", deviceName)
                    put("deviceId", deviceId)
                    put("totalFiles", filesList.size)
                    put("totalBytes", totalBytes)
                    put("files", filesJsonArr)
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

                // Negotiation Response
                input.readFully(header)
                val negRespLen = header.readUInt32BE(8)
                val negRespBytes = ByteArray(negRespLen)
                input.readFully(negRespBytes)
                val negRespJson = JSONObject(String(negRespBytes, Charsets.UTF_8))

                if (!negRespJson.optBoolean("accepted", false)) {
                    sendEvent("transferError", mapOf(
                        "transferId" to transferId,
                        "error" to "Recipient declined the transfer request."
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

                            // Direct 8-byte binary header payload: [chunkIdx, offset]
                            val payload = ByteArray(8 + bytesRead)
                            payload.writeUInt32BE(chunkIdx, 0)
                            payload.writeUInt32BE(fileSent.toInt(), 4)
                            System.arraycopy(chunkBuffer, 0, payload, 8, bytesRead)

                            // Send frame (buffer without premature flush to keep TCP window wide)
                            output.write(buildFrame(0x21, payload))

                            fileSent += bytesRead
                            overallSent += bytesRead
                            chunkIdx++

                            // Throttle EventChannel UI updates to 11/sec
                            val now = System.currentTimeMillis()
                            if (now - lastEventTime >= PROGRESS_EVENT_INTERVAL_MS) {
                                lastEventTime = now
                                val elapsedSec = Math.max(0.1, (now - startTime) / 1000.0)
                                val speedBytesPerSec = (overallSent / elapsedSec).toLong()
                                val rawPct = (overallSent.toDouble() / Math.max(1L, totalBytes).toDouble()) * 100.0
                                val safePct = if (overallSent >= totalBytes) 99.9 else Math.min(99.9, rawPct)
                                val eta = Math.max(0, ((totalBytes - overallSent) / Math.max(1L, speedBytesPerSec)).toInt())

                                sendEvent("transferProgress", mapOf(
                                    "transferId" to transferId,
                                    "state" to "TRANSFERRING",
                                    "fileName" to fileName,
                                    "transferredBytes" to overallSent,
                                    "totalBytes" to totalBytes,
                                    "speedBytesPerSec" to speedBytesPerSec,
                                    "percentage" to safePct,
                                    "etaSeconds" to eta,
                                    "verificationState" to "STREAMING"
                                ))

                                updateForegroundTransferProgress(safePct.toInt(), formatSpeed(speedBytesPerSec))
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
    private fun sendOfflineChatMessage(targetIp: String, peerId: String, peerName: String, text: String) {
        val messageId = "msg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8)
        val timestamp = System.currentTimeMillis()

        val msgMap = mapOf(
            "id" to messageId,
            "peerId" to peerId,
            "peerName" to peerName,
            "senderId" to deviceId,
            "text" to text,
            "timestamp" to timestamp,
            "status" to "sending"
        )
        dbHelper.insertChatMessage(msgMap)
        sendEvent("chatMessageSent", msgMap)

        scope.launch(Dispatchers.IO) {
            var chatSocket: Socket? = null
            try {
                chatSocket = Socket().apply {
                    tcpNoDelay = true
                    connect(InetSocketAddress(targetIp, DEFAULT_PORT), 4000)
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
                dbHelper.updateChatMessageStatus(messageId, status)
                sendEvent("chatMessageStatusUpdated", mapOf("id" to messageId, "status" to status))
            } catch (e: Exception) {
                Log.e(TAG, "Chat sending error: ${e.message}")
                dbHelper.updateChatMessageStatus(messageId, "failed")
                sendEvent("chatMessageStatusUpdated", mapOf("id" to messageId, "status" to "failed"))
            } finally {
                chatSocket?.close()
            }
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

    private fun InputStream.readFully(b: ByteArray) {
        var offset = 0
        while (offset < b.size) {
            val count = this.read(b, offset, b.size - offset)
            if (count < 0) throw EOFException("Unexpected EOF while reading socket frame")
            offset += count
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
            if (!file.exists()) return false

            val uri = FileProvider.getUriForFile(this, "${applicationContext.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, contentResolver.getType(uri) ?: "*/*")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            true
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
        totalFiles: Int,
        totalBytes: Long,
        sasCode: String
    ) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Intent to open AuraDrop app
            val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                putExtra("incoming_transfer_id", transferId)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val openPendingIntent = PendingIntent.getActivity(
                this,
                transferId.hashCode(),
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Decline Intent
            val declineIntent = Intent(this, AuraNotificationActionReceiver::class.java).apply {
                action = AuraNotificationActionReceiver.ACTION_NOTIFICATION_DECLINE
                putExtra(AuraNotificationActionReceiver.EXTRA_TRANSFER_ID, transferId)
            }
            val declinePendingIntent = PendingIntent.getBroadcast(
                this,
                transferId.hashCode() + 1,
                declineIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Accept Intent
            val acceptIntent = Intent(this, AuraNotificationActionReceiver::class.java).apply {
                action = AuraNotificationActionReceiver.ACTION_NOTIFICATION_ACCEPT
                putExtra(AuraNotificationActionReceiver.EXTRA_TRANSFER_ID, transferId)
            }
            val acceptPendingIntent = PendingIntent.getBroadcast(
                this,
                transferId.hashCode() + 2,
                acceptIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val builder = NotificationCompat.Builder(this, INCOMING_REQUEST_CHANNEL_ID)
                .setContentTitle("AuraDrop • Incoming Share")
                .setContentText("$senderName wants to send $totalFiles file(s) • ${formatBytes(totalBytes)}")
                .setSubText("SAS: $sasCode")
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(openPendingIntent)
                .addAction(android.R.drawable.ic_delete, "Decline", declinePendingIntent)
                .addAction(android.R.drawable.stat_sys_download, "Accept", acceptPendingIntent)

            nm.notify(transferId.hashCode(), builder.build())
        } catch (e: Exception) {
            Log.e(TAG, "Error posting system incoming share notification: ${e.message}")
        }
    }

    private fun cancelSystemIncomingShareNotification(transferId: String) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(transferId.hashCode())
        } catch (e: Exception) {}
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

    override fun onDestroy() {
        if (activeInstance == this) activeInstance = null
        stopDiscoveryEngine()
        scope.cancel()
        transferServer?.close()
        dbHelper.close()
        super.onDestroy()
    }
}
