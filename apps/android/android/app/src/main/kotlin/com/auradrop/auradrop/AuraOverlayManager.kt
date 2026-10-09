package com.auradrop.auradrop

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.ImageView
import android.widget.TextView
import java.io.File

class AuraOverlayManager private constructor(private val context: Context) {
    companion object {
        private const val TAG = "AuraOverlay"

        @Volatile
        private var instance: AuraOverlayManager? = null

        fun getInstance(context: Context): AuraOverlayManager {
            return instance ?: synchronized(this) {
                instance ?: AuraOverlayManager(context.applicationContext).also { instance = it }
            }
        }
    }

    private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private var currentOverlayView: View? = null
    private var autoDismissRunnable: Runnable? = null

    fun canDrawOverlays(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
    }

    fun requestOverlayPermission(activity: Activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            try {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${context.packageName}")
                )
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to launch overlay permission settings: ${e.message}")
            }
        }
    }

    fun showNameDropOverlay(
        peerId: String = "",
        peerName: String,
        deviceName: String = "",
        platform: String = "device",
        ip: String = "",
        onShare: (() -> Unit)? = null
    ) {
        mainHandler.post {
            dismissCurrentOverlay()
            if (!canDrawOverlays()) {
                Log.w(TAG, "Overlay permission not granted; cannot display on mobile screen over other apps")
                return@post
            }

            try {
                val inflater = LayoutInflater.from(context)
                val view = inflater.inflate(R.layout.view_floating_dynamic_island, null)

                val tvTitle = view.findViewById<TextView>(R.id.tv_title)
                val tvSubtitle = view.findViewById<TextView>(R.id.tv_sender_subtitle)
                val tvStatusBadge = view.findViewById<TextView>(R.id.tv_status_badge)
                val tvDeviceIcon = view.findViewById<TextView>(R.id.tv_device_icon)
                val btnDecline = view.findViewById<View>(R.id.btn_decline_container)
                val btnAccept = view.findViewById<View>(R.id.btn_accept_container)
                val tvBtnDecline = view.findViewById<TextView>(R.id.tv_btn_decline)
                val tvBtnAccept = view.findViewById<TextView>(R.id.tv_btn_accept)
                val pillCard = view.findViewById<View>(R.id.pill_card_container)

                val isWindows = platform.contains("win", ignoreCase = true)
                val platformDisplay = if (isWindows) "Windows PC" else if (platform.contains("android", ignoreCase = true)) "Android Device" else platform.replaceFirstChar { it.uppercase() }

                tvTitle.text = "AuraDrop Nearby"
                tvSubtitle.text = "$peerName • $platformDisplay"
                tvStatusBadge.text = if (ip.isNotBlank()) "$ip • LAN 24/7 Proximity" else "Direct Wi-Fi • Ready"
                tvDeviceIcon.text = if (isWindows) "💻" else "📱"
                tvBtnDecline.text = "Dismiss"
                tvBtnAccept.text = "Share Files"

                btnDecline.setOnClickListener {
                    dismissCurrentOverlay()
                }

                btnAccept.setOnClickListener {
                    onShare?.invoke()
                    launchApp()
                    dismissCurrentOverlay()
                }

                pillCard.setOnClickListener {
                    onShare?.invoke()
                    launchApp()
                    dismissCurrentOverlay()
                }

                addAndAnimateView(view, pillCard, autoDismissDelay = 8000L)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to show NameDrop overlay: ${e.message}")
            }
        }
    }

    fun showTransferRequestOverlay(
        transferId: String,
        senderName: String,
        fileName: String,
        totalBytes: Long,
        previewImagePath: String? = null,
        onAccept: () -> Unit,
        onDecline: () -> Unit
    ) {
        mainHandler.post {
            dismissCurrentOverlay()
            if (!canDrawOverlays()) {
                Log.w(TAG, "Overlay permission not granted; cannot display on mobile screen over other apps")
                return@post
            }

            try {
                val inflater = LayoutInflater.from(context)
                val view = inflater.inflate(R.layout.view_floating_dynamic_island, null)

                val tvTitle = view.findViewById<TextView>(R.id.tv_title)
                val tvSubtitle = view.findViewById<TextView>(R.id.tv_sender_subtitle)
                val tvStatusBadge = view.findViewById<TextView>(R.id.tv_status_badge)
                val btnDecline = view.findViewById<View>(R.id.btn_decline_container)
                val btnAccept = view.findViewById<View>(R.id.btn_accept_container)
                val tvBtnDecline = view.findViewById<TextView>(R.id.tv_btn_decline)
                val tvBtnAccept = view.findViewById<TextView>(R.id.tv_btn_accept)
                val ivPreview = view.findViewById<ImageView>(R.id.iv_preview_thumbnail)
                val previewContainer = view.findViewById<View>(R.id.preview_thumbnail_container)
                val pillCard = view.findViewById<View>(R.id.pill_card_container)

                tvTitle.text = "AuraDrop Request"
                tvSubtitle.text = "$senderName wants to send $fileName"
                tvStatusBadge.text = "${formatBytes(totalBytes)} • Direct LAN"
                tvBtnDecline.text = "Decline"
                tvBtnAccept.text = "Accept"

                if (!previewImagePath.isNullOrBlank()) {
                    try {
                        val file = File(previewImagePath)
                        if (file.exists()) {
                            val bmp = BitmapFactory.decodeFile(file.absolutePath)
                            if (bmp != null) {
                                ivPreview.setImageBitmap(bmp)
                                previewContainer.visibility = View.VISIBLE
                            }
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error loading preview image: ${e.message}")
                    }
                }

                btnDecline.setOnClickListener {
                    onDecline()
                    dismissCurrentOverlay()
                }

                btnAccept.setOnClickListener {
                    onAccept()
                    launchApp()
                    dismissCurrentOverlay()
                }

                pillCard.setOnClickListener {
                    launchApp()
                }

                addAndAnimateView(view, pillCard, autoDismissDelay = 50000L)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to show transfer request overlay: ${e.message}")
            }
        }
    }

    private fun addAndAnimateView(
        rootView: View,
        pillCard: View,
        autoDismissDelay: Long
    ) {
        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = 0
        }

        try {
            windowManager.addView(rootView, params)
            currentOverlayView = rootView
        } catch (e: Exception) {
            Log.e(TAG, "windowManager.addView failed: ${e.message}")
            return
        }

        // Clean drop-down spring entrance: zero background circles or ripples
        pillCard.translationY = -280f
        pillCard.scaleX = 0.90f
        pillCard.scaleY = 0.90f
        pillCard.alpha = 0f

        val pillTransY = ObjectAnimator.ofFloat(pillCard, "translationY", -280f, 0f).apply {
            duration = 550
            interpolator = OvershootInterpolator(1.15f)
        }
        val pillScaleX = ObjectAnimator.ofFloat(pillCard, "scaleX", 0.90f, 1f).apply {
            duration = 550
            interpolator = OvershootInterpolator(1.05f)
        }
        val pillScaleY = ObjectAnimator.ofFloat(pillCard, "scaleY", 0.90f, 1f).apply {
            duration = 550
            interpolator = OvershootInterpolator(1.05f)
        }
        val pillAlpha = ObjectAnimator.ofFloat(pillCard, "alpha", 0f, 1f).apply {
            duration = 350
        }

        AnimatorSet().apply {
            playTogether(pillTransY, pillScaleX, pillScaleY, pillAlpha)
            start()
        }

        // Auto dismiss timer
        autoDismissRunnable = Runnable {
            dismissCurrentOverlay()
        }
        mainHandler.postDelayed(autoDismissRunnable!!, autoDismissDelay)
    }

    fun dismissCurrentOverlay() {
        autoDismissRunnable?.let { mainHandler.removeCallbacks(it) }
        autoDismissRunnable = null

        val v = currentOverlayView ?: return
        currentOverlayView = null

        val pillCard = v.findViewById<View>(R.id.pill_card_container)
        if (pillCard != null) {
            val transY = ObjectAnimator.ofFloat(pillCard, "translationY", 0f, -280f).setDuration(280)
            val alpha = ObjectAnimator.ofFloat(pillCard, "alpha", 1f, 0f).setDuration(220)
            AnimatorSet().apply {
                playTogether(transY, alpha)
                addListener(object : AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: Animator) {
                        try {
                            windowManager.removeView(v)
                        } catch (e: Exception) {}
                    }
                })
                start()
            }
        } else {
            try {
                windowManager.removeView(v)
            } catch (e: Exception) {}
        }
    }

    private fun formatBytes(bytes: Long): String {
        if (bytes <= 0) return "0 B"
        val kb = bytes / 1024.0
        val mb = kb / 1024.0
        val gb = mb / 1024.0
        return when {
            gb >= 1.0 -> String.format("%.2f GB", gb)
            mb >= 1.0 -> String.format("%.1f MB", mb)
            kb >= 1.0 -> String.format("%.0f KB", kb)
            else -> "$bytes B"
        }
    }

    private fun launchApp() {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            context.startActivity(launchIntent)
        }
    }
}
