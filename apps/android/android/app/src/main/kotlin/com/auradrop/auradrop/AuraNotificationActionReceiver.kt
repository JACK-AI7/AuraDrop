package com.auradrop.auradrop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class AuraNotificationActionReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "AuraNotificationAction"
        const val ACTION_NOTIFICATION_ACCEPT = "com.auradrop.app.ACTION_NOTIFICATION_ACCEPT"
        const val ACTION_NOTIFICATION_DECLINE = "com.auradrop.app.ACTION_NOTIFICATION_DECLINE"
        const val EXTRA_TRANSFER_ID = "transfer_id"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val transferId = intent.getStringExtra(EXTRA_TRANSFER_ID) ?: return
        Log.d(TAG, "Notification action received: ${intent.action} for transfer: $transferId")

        when (intent.action) {
            ACTION_NOTIFICATION_ACCEPT -> {
                MainActivity.handleSystemNotificationAction(context, transferId, true)
            }
            ACTION_NOTIFICATION_DECLINE -> {
                MainActivity.handleSystemNotificationAction(context, transferId, false)
            }
        }
    }
}
