package com.auradrop.auradrop

import android.Manifest
import android.app.Activity
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
        private const val DEFAULT_PORT = 48291
        private const val DISCOVERY_GROUP = "239.255.48.29"
        private const val DISCOVERY_PORT = 48290
        private const val SOCKET_BUFFER_SIZE = 1024 * 1024 // 1 MB buffer for high throughput
    }

    private var eventSink: EventChannel.EventSink? = null
    private var pendingFilePickResult: MethodChannel.Result? = null

    private var multicastLock: WifiManager.MulticastLock? = null
    private var isDiscovering = false
    private var discoveryJob: Job? = null
    private var serverJob: Job? = null
    private var transferServer: ServerSocket? = null

    // Store active sockets and sessions
    private val activeClientSockets = ConcurrentHashMap<String, Socket>()
    private val activeTransfersState = ConcurrentHashMap<String, TransferSession>()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val deviceId = "android_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10)
    private val deviceName = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"

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
        handleSendIntent(intent)
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
                    val beacon = JSONObject().apply {
                        put("type", "AURADROP_BEACON")
                        put("protocol", "P2PFS/1")
                        put("deviceId", deviceId)
                        put("name", deviceName)
                        put("platform", "android")
                        put("transferPort", DEFAULT_PORT)
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
                            "platform" to json.optString("platform", "android"),
                            "ip" to packet.address.hostAddress,
                            "port" to json.optInt("transferPort", DEFAULT_PORT)
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
    // TCP Streaming Server (High-Speed Receiver)
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
            // 1. DATA_CHANNEL_CONNECTING: Read Handshake Init
            sendEvent("dataChannelState", mapOf(
                "transferId" to transferId,
                "state" to "DATA_CHANNEL_CONNECTING"
            ))

            val header = ByteArray(20)
            input.readFully(header)
            val payloadLen = header.readUInt32BE(8)
            val payloadBytes = ByteArray(payloadLen)
            input.readFully(payloadBytes)
            val handshakeJson = JSONObject(String(payloadBytes, Charsets.UTF_8))
            val clientNonce = handshakeJson.optString("nonce")

            // Reply Handshake Resp
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

            // 2. Health-Check: Read PING and reply PONG
            input.readFully(header)
            val pingLen = header.readUInt32BE(8)
            val pingBytes = ByteArray(pingLen)
            input.readFully(pingBytes)

            // Echo PONG
            output.write(buildFrame(0x04, pingBytes))
            output.flush()

            // 3. READY_TO_TRANSFER: Read Negotiation Request
            sendEvent("dataChannelState", mapOf(
                "transferId" to transferId,
                "state" to "READY_TO_TRANSFER"
            ))

            input.readFully(header)
            val negLen = header.readUInt32BE(8)
            val negBytes = ByteArray(negLen)
            input.readFully(negBytes)
            val negJson = JSONObject(String(negBytes, Charsets.UTF_8))

            val senderName = handshakeJson.optString("deviceName", "Nearby Peer")
            val totalFiles = negJson.optInt("totalFiles", 1)
            val totalBytes = negJson.optLong("totalBytes", 0L)
            val filesArray = negJson.optJSONArray("files") ?: JSONArray()
            val filesList = mutableListOf<Map<String, Any>>()
            for (i in 0 until filesArray.length()) {
                val f = filesArray.getJSONObject(i)
                filesList.add(mapOf(
                    "id" to f.getString("id"),
                    "name" to f.getString("name"),
                    "size" to f.getLong("size"),
                    "mimeType" to f.optString("mimeType", "application/octet-stream"),
                    "expectedChecksum" to f.optString("checksum", "")
                ))
            }

            val sasCode = generateSasCode(deviceId, handshakeJson.optString("deviceId"))

            // Emit Request to Flutter UI for user consent
            sendEvent("transferRequest", mapOf(
                "transferId" to transferId,
                "senderName" to senderName,
                "totalFiles" to totalFiles,
                "totalBytes" to totalBytes,
                "sas" to sasCode,
                "files" to filesList,
                "connectionState" to "WAITING_FOR_ACCEPTANCE"
            ))

            // Wait until user accepts or declines via MethodChannel
        } catch (e: Exception) {
            Log.e(TAG, "Inbound handshake failed: ${e.message}")
            socket.close()
            activeClientSockets.remove(transferId)
            activeTransfersState.remove(transferId)
        }
    }

    private fun acceptIncomingTransfer(transferId: String) {
        val session = activeTransfersState[transferId] ?: return
        val socket = session.socket

        scope.launch(Dispatchers.IO) {
            var currentFileOut: FileOutputStream? = null
            var currentPartFile: File? = null
            var currentFinalFile: File? = null

            try {
                val input = BufferedInputStream(socket.getInputStream(), SOCKET_BUFFER_SIZE)
                val output = BufferedOutputStream(socket.getOutputStream(), SOCKET_BUFFER_SIZE)

                // Send Negotiation Accept
                val acceptJson = JSONObject().apply {
                    put("transferId", transferId)
                    put("accepted", true)
                }
                output.write(buildFrame(0x11, acceptJson.toString().toByteArray()))
                output.flush()

                startForegroundTransferService("Receiving files...", 0)

                // Prepare Downloads/AuraDrop Directory
                val downloadsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AuraDrop").apply {
                    if (!exists()) mkdirs()
                }

                var overallReceived = 0L
                var totalExpectedTransferBytes = 1L
                val startTime = System.currentTimeMillis()

                var currentFileExpectedBytes = 0L
                var currentFileReceivedBytes = 0L
                var currentExpectedChecksum = ""
                var currentMimeType = "application/octet-stream"
                var currentDigest: MessageDigest? = null

                val header = ByteArray(20)

                while (socket.isConnected && !socket.isClosed && !session.isCancelled.get()) {
                    val read = input.read(header, 0, 20)
                    if (read == -1) break
                    if (read < 20) input.readFullyRemaining(header, read, 20 - read)

                    val frameType = header[5].toInt()
                    val payloadLen = header.readUInt32BE(8)

                    when (frameType) {
                        0x20 -> { // FILE_START
                            val pBytes = ByteArray(payloadLen)
                            input.readFully(pBytes)
                            val fInfo = JSONObject(String(pBytes, Charsets.UTF_8))

                            val rawFileName = fInfo.getString("filename")
                            val safeName = sanitizeFilename(rawFileName)
                            currentFileExpectedBytes = fInfo.getLong("size")
                            currentExpectedChecksum = fInfo.optString("checksum", "")
                            currentMimeType = fInfo.optString("mimeType", "application/octet-stream")
                            totalExpectedTransferBytes = fInfo.optLong("totalTransferBytes", currentFileExpectedBytes)

                            // Resolve duplicate file name collision
                            currentFinalFile = resolveUniqueFile(downloadsDir, safeName)
                            currentPartFile = File(downloadsDir, "${currentFinalFile.name}.part")
                            if (currentPartFile.exists()) currentPartFile.delete()

                            currentFileOut = FileOutputStream(currentPartFile, false)
                            currentFileReceivedBytes = 0L
                            currentDigest = MessageDigest.getInstance("SHA-256")

                            sendEvent("transferProgress", mapOf(
                                "transferId" to transferId,
                                "state" to "TRANSFERRING",
                                "fileName" to currentFinalFile.name,
                                "transferredBytes" to overallReceived,
                                "totalBytes" to totalExpectedTransferBytes,
                                "speedBytesPerSec" to 0L,
                                "percentage" to 0,
                                "verificationState" to "STREAMING"
                            ))
                        }

                        0x21 -> { // CHUNK_DATA
                            // Read chunk JSON header length
                            val hLenBytes = ByteArray(4)
                            input.readFully(hLenBytes)
                            val hLen = hLenBytes.readUInt32BE(0)
                            val hJsonBytes = ByteArray(hLen)
                            input.readFully(hJsonBytes)

                            // Read actual binary chunk data
                            val chunkDataLen = payloadLen - 4 - hLen
                            val chunkData = ByteArray(chunkDataLen)
                            input.readFully(chunkData)

                            // Read 16 bytes auth tag if present
                            val flags = header[7].toInt()
                            if (flags and 0x08 != 0) {
                                val tag = ByteArray(16)
                                input.readFully(tag)
                            }

                            // Write chunk data straight to disk!
                            currentFileOut?.write(chunkData)
                            currentDigest?.update(chunkData)

                            currentFileReceivedBytes += chunkDataLen
                            overallReceived += chunkDataLen

                            val elapsedSec = Math.max(0.1, (System.currentTimeMillis() - startTime) / 1000.0)
                            val speedBytesPerSec = (overallReceived / elapsedSec).toLong()
                            val pct = Math.min(100, ((overallReceived * 100) / Math.max(1, totalExpectedTransferBytes)).toInt())
                            val eta = Math.max(0, ((totalExpectedTransferBytes - overallReceived) / Math.max(1, speedBytesPerSec)).toInt())

                            sendEvent("transferProgress", mapOf(
                                "transferId" to transferId,
                                "state" to "TRANSFERRING",
                                "fileName" to (currentFinalFile?.name ?: "Receiving"),
                                "transferredBytes" to overallReceived,
                                "totalBytes" to totalExpectedTransferBytes,
                                "speedBytesPerSec" to speedBytesPerSec,
                                "percentage" to pct,
                                "etaSeconds" to eta,
                                "verificationState" to "STREAMING"
                            ))

                            updateForegroundTransferProgress(pct, formatSpeed(speedBytesPerSec))
                        }

                        0x23 -> { // FILE_END
                            val pBytes = ByteArray(payloadLen)
                            input.readFully(pBytes)
                            val endInfo = JSONObject(String(pBytes, Charsets.UTF_8))
                            val finalExpectedSha = endInfo.optString("checksum", currentExpectedChecksum)

                            // Flush and close file output stream
                            currentFileOut?.flush()
                            currentFileOut?.close()
                            currentFileOut = null

                            // Calculate actual received SHA-256
                            sendEvent("transferProgress", mapOf(
                                "transferId" to transferId,
                                "state" to "VERIFYING",
                                "verificationState" to "VERIFYING_SHA256"
                            ))

                            val actualSha256 = currentDigest?.digest()?.toHex() ?: ""
                            val isChecksumValid = finalExpectedSha.isEmpty() || finalExpectedSha.equals(actualSha256, ignoreCase = true)

                            if (!isChecksumValid) {
                                currentPartFile?.delete()
                                output.write(buildFrame(0x26, JSONObject().apply {
                                    put("status", "FAILED_INTEGRITY")
                                    put("expected", finalExpectedSha)
                                    put("actual", actualSha256)
                                }.toString().toByteArray()))
                                output.flush()
                                throw IOException("Checksum mismatch! File corrupt or tampered.")
                            }

                            // Rename .part to final destination file
                            if (currentPartFile != null && currentFinalFile != null) {
                                currentPartFile.renameTo(currentFinalFile)
                                // Scan file with MediaStore so it appears instantly in Photos/Files
                                MediaScannerConnection.scanFile(
                                    applicationContext,
                                    arrayOf(currentFinalFile.absolutePath),
                                    arrayOf(currentMimeType),
                                    null
                                )
                            }

                            // Reply FILE_ACK with VERIFIED_OK
                            output.write(buildFrame(0x25, JSONObject().apply {
                                put("status", "VERIFIED_OK")
                                put("checksum", actualSha256)
                            }.toString().toByteArray()))
                            output.flush()
                        }

                        0x24 -> { // TRANSFER_COMPLETE
                            val pBytes = ByteArray(payloadLen)
                            input.readFully(pBytes)

                            stopForegroundTransferService()

                            sendEvent("transferCompleted", mapOf(
                                "transferId" to transferId,
                                "savedPath" to (currentFinalFile?.absolutePath ?: ""),
                                "fileName" to (currentFinalFile?.name ?: ""),
                                "totalBytes" to overallReceived,
                                "verificationState" to "VERIFIED"
                            ))
                            break
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Transfer reception error: ${e.message}")
                currentFileOut?.close()
                currentPartFile?.delete()
                stopForegroundTransferService()
                sendEvent("transferError", mapOf(
                    "transferId" to transferId,
                    "error" to (e.message ?: "Transfer failed")
                ))
            } finally {
                socket.close()
                activeClientSockets.remove(transferId)
                activeTransfersState.remove(transferId)
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
                // 1. DATA_CHANNEL_CONNECTING: Socket connection & buffers
                sendEvent("dataChannelState", mapOf(
                    "transferId" to transferId,
                    "state" to "DATA_CHANNEL_CONNECTING"
                ))

                socket = Socket().apply {
                    tcpNoDelay = true
                    sendBufferSize = SOCKET_BUFFER_SIZE
                    receiveBufferSize = SOCKET_BUFFER_SIZE
                    connect(InetSocketAddress(targetIp, targetPort), 7000)
                }

                val session = TransferSession(transferId, socket)
                activeTransfersState[transferId] = session
                activeClientSockets[transferId] = socket

                val output = BufferedOutputStream(socket.getOutputStream(), SOCKET_BUFFER_SIZE)
                val input = BufferedInputStream(socket.getInputStream(), SOCKET_BUFFER_SIZE)

                // 2. Handshake Init
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

                // Verify Nonce Echo
                if (respJson.optString("nonceEcho") != clientNonce) {
                    throw IOException("Handshake integrity check failed")
                }

                // 3. Bidirectional Health-Check Ping / Pong
                val pingData = "HEALTH_PING_${System.currentTimeMillis()}".toByteArray()
                output.write(buildFrame(0x03, pingData))
                output.flush()

                input.readFully(header)
                val pongLen = header.readUInt32BE(8)
                val pongBytes = ByteArray(pongLen)
                input.readFully(pongBytes)

                // 4. State transitions to READY_TO_TRANSFER
                sendEvent("dataChannelState", mapOf(
                    "transferId" to transferId,
                    "state" to "READY_TO_TRANSFER"
                ))

                // 5. Send Negotiation Request
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

                // 6. Read Negotiation Response (Accept / Decline)
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

                // 7. Stream Files with Adaptive Chunk Engine (256 KB -> 512 KB -> 1 MB)
                var currentChunkSize = 256 * 1024
                var chunkBuffer = ByteArray(currentChunkSize)
                var overallSent = 0L
                val startTime = System.currentTimeMillis()

                for (fileMap in filesList) {
                    if (session.isCancelled.get()) break

                    val uriStr = fileMap["uri"] as? String ?: continue
                    val fileName = fileMap["name"] as? String ?: "file"
                    val fileSize = (fileMap["size"] as? Number)?.toLong() ?: 0L
                    val mimeType = fileMap["mimeType"] as? String ?: "application/octet-stream"

                    // Calculate incremental SHA-256 while streaming
                    val fileDigest = MessageDigest.getInstance("SHA-256")

                    // Send FILE_START
                    val startJson = JSONObject().apply {
                        put("fileId", fileMap["id"] ?: "f1")
                        put("filename", fileName)
                        put("size", fileSize)
                        put("mimeType", mimeType)
                        put("totalTransferBytes", totalBytes)
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
                            // Adapt chunk size dynamically based on measured throughput
                            val elapsedNow = Math.max(0.1, (System.currentTimeMillis() - startTime) / 1000.0)
                            val currentSpeed = overallSent / elapsedNow
                            val targetChunkSize = when {
                                currentSpeed > 30 * 1024 * 1024 -> 1024 * 1024 // 1 MB
                                currentSpeed > 10 * 1024 * 1024 -> 512 * 1024  // 512 KB
                                else -> 256 * 1024                              // 256 KB
                            }
                            if (targetChunkSize != currentChunkSize) {
                                currentChunkSize = targetChunkSize
                                chunkBuffer = ByteArray(currentChunkSize)
                            }

                            val toRead = Math.min(currentChunkSize.toLong(), fileSize - fileSent).toInt()
                            val bytesRead = bufferedStream.read(chunkBuffer, 0, toRead)
                            if (bytesRead <= 0) break

                            // Update SHA-256 digest
                            fileDigest.update(chunkBuffer, 0, bytesRead)

                            // Frame Chunk Header
                            val chunkInfo = JSONObject().apply {
                                put("chunkIndex", chunkIdx)
                                put("length", bytesRead)
                                put("offset", fileSent)
                            }
                            val hBytes = chunkInfo.toString().toByteArray(Charsets.UTF_8)
                            val hLenBytes = ByteArray(4).apply { writeUInt32BE(hBytes.size, 0) }

                            val payload = ByteArray(4 + hBytes.size + bytesRead).apply {
                                System.arraycopy(hLenBytes, 0, this, 0, 4)
                                System.arraycopy(hBytes, 0, this, 4, hBytes.size)
                                System.arraycopy(chunkBuffer, 0, this, 4 + hBytes.size, bytesRead)
                            }

                            // Write CHUNK_DATA frame with tag
                            val fakeTag = ByteArray(16)
                            output.write(buildFrame(0x21, payload, fakeTag))
                            output.flush()

                            fileSent += bytesRead
                            overallSent += bytesRead
                            chunkIdx++

                            val elapsedSec = Math.max(0.1, (System.currentTimeMillis() - startTime) / 1000.0)
                            val speedBytesPerSec = (overallSent / elapsedSec).toLong()
                            val pct = Math.min(100, ((overallSent * 100) / Math.max(1, totalBytes)).toInt())
                            val eta = Math.max(0, ((totalBytes - overallSent) / Math.max(1, speedBytesPerSec)).toInt())

                            sendEvent("transferProgress", mapOf(
                                "transferId" to transferId,
                                "state" to "TRANSFERRING",
                                "fileName" to fileName,
                                "transferredBytes" to overallSent,
                                "totalBytes" to totalBytes,
                                "speedBytesPerSec" to speedBytesPerSec,
                                "percentage" to pct,
                                "etaSeconds" to eta,
                                "verificationState" to "STREAMING"
                            ))

                            updateForegroundTransferProgress(pct, formatSpeed(speedBytesPerSec))
                        }
                    }

                    // Compute final sender SHA-256
                    val senderSha256 = fileDigest.digest().toHex()

                    // Send FILE_END with computed SHA-256
                    output.write(buildFrame(0x23, JSONObject().apply {
                        put("fileId", fileMap["id"])
                        put("checksum", senderSha256)
                    }.toString().toByteArray()))
                    output.flush()

                    // Await FILE_ACK from receiver
                    sendEvent("transferProgress", mapOf(
                        "transferId" to transferId,
                        "state" to "VERIFYING",
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
                }

                // Send TRANSFER_COMPLETE
                output.write(buildFrame(0x24, JSONObject().apply {
                    put("transferId", transferId)
                    put("status", "complete")
                }.toString().toByteArray()))
                output.flush()

                stopForegroundTransferService()

                sendEvent("transferCompleted", mapOf(
                    "transferId" to transferId,
                    "totalBytes" to overallSent,
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
        // Sequence Number (bytes 12-19)
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

    override fun onDestroy() {
        stopDiscoveryEngine()
        scope.cancel()
        transferServer?.close()
        super.onDestroy()
    }
}
