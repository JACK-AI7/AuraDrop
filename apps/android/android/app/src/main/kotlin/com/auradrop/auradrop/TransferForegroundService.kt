package com.auradrop.auradrop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import java.io.File

class TransferForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "auradrop_transfers"
        const val CHANNEL_NAME = "AuraDrop Transfers"
        const val NOTIFICATION_ID = 4829

        const val ACTION_START = "ACTION_START"
        const val ACTION_UPDATE = "ACTION_UPDATE"
        const val ACTION_STOP = "ACTION_STOP"
        const val ACTION_COMPLETE = "ACTION_COMPLETE"

        const val EXTRA_TITLE = "EXTRA_TITLE"
        const val EXTRA_PROGRESS = "EXTRA_PROGRESS"
        const val EXTRA_SPEED = "EXTRA_SPEED"
        const val EXTRA_FILE_PATH = "EXTRA_FILE_PATH"
        const val EXTRA_FILE_NAME = "EXTRA_FILE_NAME"
    }

    private var lastUpdateTime = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "Transferring files..."
                val progress = intent.getIntExtra(EXTRA_PROGRESS, 0)
                val notification = buildOngoingNotification(title, progress, "Establishing data stream...")
                startForeground(NOTIFICATION_ID, notification)
            }
            ACTION_UPDATE -> {
                val now = System.currentTimeMillis()
                // Throttle updates to at most once every 800ms to avoid Android binder IPC limits
                if (now - lastUpdateTime >= 800) {
                    lastUpdateTime = now
                    val title = intent.getStringExtra(EXTRA_TITLE) ?: "Transferring files..."
                    val progress = intent.getIntExtra(EXTRA_PROGRESS, 0)
                    val speed = intent.getStringExtra(EXTRA_SPEED) ?: ""
                    val notification = buildOngoingNotification(title, progress, speed)
                    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    manager.notify(NOTIFICATION_ID, notification)
                }
            }
            ACTION_COMPLETE -> {
                val fileName = intent.getStringExtra(EXTRA_FILE_NAME) ?: "File"
                val filePath = intent.getStringExtra(EXTRA_FILE_PATH) ?: ""
                val notification = buildCompletionNotification(fileName, filePath)
                val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                stopForeground(STOP_FOREGROUND_REMOVE)
                manager.notify(NOTIFICATION_ID + 1, notification)
                stopSelf()
            }
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows real-time status for high-speed file transfers"
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildOngoingNotification(title: String, progress: Int, content: String): Notification {
        val appIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = if (appIntent != null) {
            PendingIntent.getActivity(this, 0, appIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        } else null

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setProgress(100, progress, progress == 0)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun buildCompletionNotification(fileName: String, filePath: String): Notification {
        var openIntent: PendingIntent? = null
        if (filePath.isNotEmpty()) {
            val file = File(filePath)
            if (file.exists()) {
                val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
                val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, contentResolver.getType(uri) ?: "*/*")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                openIntent = PendingIntent.getActivity(
                    this,
                    1,
                    viewIntent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
            }
        }

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AuraDrop transfer complete")
            .setContentText("$fileName • Verified")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)

        if (openIntent != null) {
            builder.setContentIntent(openIntent)
            builder.addAction(android.R.drawable.ic_menu_view, "Open", openIntent)
        }

        return builder.build()
    }
}
