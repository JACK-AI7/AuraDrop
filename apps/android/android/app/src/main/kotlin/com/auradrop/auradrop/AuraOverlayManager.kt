package com.auradrop.auradrop

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Context
import android.content.Intent
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
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.TextView

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

    fun showNameDropOverlay(peerName: String) {
        mainHandler.post {
            dismissCurrentOverlay()
            if (!canDrawOverlays()) {
                Log.w(TAG, "Overlay permission not granted; cannot display on mobile screen over other apps")
                return@post
            }

            try {
                val inflater = LayoutInflater.from(context)
                val view = inflater.inflate(R.layout.view_floating_dynamic_island, null)

                val tvSender = view.findViewById<TextView>(R.id.tv_sender_name)
                val tvInfo = view.findViewById<TextView>(R.id.tv_file_info)
                val btnDecline = view.findViewById<View>(R.id.btn_decline_container)
                val btnAccept = view.findViewById<View>(R.id.btn_accept_container)
                val pillCard = view.findViewById<View>(R.id.pill_card_container)
                val rippleWave = view.findViewById<View>(R.id.view_fluid_ripple)

                tvSender.text = peerName
                tvInfo.text = "NameDrop Connected • Tap to share"
                btnDecline.visibility = View.GONE
                btnAccept.visibility = View.GONE

                pillCard.setOnClickListener {
                    launchApp()
                    dismissCurrentOverlay()
                }

                addAndAnimateView(view, pillCard, rippleWave, autoDismissDelay = 7000L)
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

                val tvSender = view.findViewById<TextView>(R.id.tv_sender_name)
                val tvInfo = view.findViewById<TextView>(R.id.tv_file_info)
                val btnDecline = view.findViewById<View>(R.id.btn_decline_container)
                val btnAccept = view.findViewById<View>(R.id.btn_accept_container)
                val pillCard = view.findViewById<View>(R.id.pill_card_container)
                val rippleWave = view.findViewById<View>(R.id.view_fluid_ripple)

                val sizeStr = if (totalBytes > 1024 * 1024) {
                    "${totalBytes / (1024 * 1024)} MB"
                } else if (totalBytes > 1024) {
                    "${totalBytes / 1024} KB"
                } else {
                    "$totalBytes B"
                }

                tvSender.text = senderName
                tvInfo.text = "would like to share $fileName • $sizeStr"
                btnDecline.visibility = View.VISIBLE
                btnAccept.visibility = View.VISIBLE

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

                addAndAnimateView(view, pillCard, rippleWave, autoDismissDelay = 45000L)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to show transfer request overlay: ${e.message}")
            }
        }
    }

    private fun addAndAnimateView(
        rootView: View,
        pillCard: View,
        rippleWave: View,
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
            y = 20
        }

        try {
            windowManager.addView(rootView, params)
            currentOverlayView = rootView
        } catch (e: Exception) {
            Log.e(TAG, "windowManager.addView failed: ${e.message}")
            return
        }

        // Apple fluid light-ripple animation shooting out from top of screen:
        rippleWave.scaleX = 0.2f
        rippleWave.scaleY = 0.2f
        rippleWave.alpha = 0f

        val rippleScaleX = ObjectAnimator.ofFloat(rippleWave, "scaleX", 0.2f, 1.5f).apply {
            duration = 900
            interpolator = DecelerateInterpolator()
        }
        val rippleScaleY = ObjectAnimator.ofFloat(rippleWave, "scaleY", 0.2f, 1.5f).apply {
            duration = 900
            interpolator = DecelerateInterpolator()
        }
        val rippleAlpha = ObjectAnimator.ofFloat(rippleWave, "alpha", 0f, 0.9f, 0f).apply {
            duration = 900
        }

        // Dynamic Island pill entrance with spring overshoot:
        pillCard.translationY = -260f
        pillCard.scaleX = 0.8f
        pillCard.scaleY = 0.8f
        pillCard.alpha = 0f

        val pillTransY = ObjectAnimator.ofFloat(pillCard, "translationY", -260f, 0f).apply {
            duration = 600
            interpolator = OvershootInterpolator(1.3f)
        }
        val pillScaleX = ObjectAnimator.ofFloat(pillCard, "scaleX", 0.8f, 1f).apply {
            duration = 600
            interpolator = OvershootInterpolator(1.1f)
        }
        val pillScaleY = ObjectAnimator.ofFloat(pillCard, "scaleY", 0.8f, 1f).apply {
            duration = 600
            interpolator = OvershootInterpolator(1.1f)
        }
        val pillAlpha = ObjectAnimator.ofFloat(pillCard, "alpha", 0f, 1f).apply {
            duration = 350
        }

        AnimatorSet().apply {
            playTogether(rippleScaleX, rippleScaleY, rippleAlpha, pillTransY, pillScaleX, pillScaleY, pillAlpha)
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
            val transY = ObjectAnimator.ofFloat(pillCard, "translationY", 0f, -260f).setDuration(300)
            val alpha = ObjectAnimator.ofFloat(pillCard, "alpha", 1f, 0f).setDuration(250)
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

    private fun launchApp() {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            context.startActivity(launchIntent)
        }
    }
}
