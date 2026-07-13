package com.iptv.apkinstaller
// TODO: replace "com.rubytv" above with your app's actual applicationId / package,
// and move this file to android/app/src/main/java/<your/package/path>/apkinstaller/

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log

class ApkInstallReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_INSTALL_COMPLETE = "com.iptv.apkinstaller.INSTALL_COMPLETE"
        private const val TAG = "ApkInstaller"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(
            PackageInstaller.EXTRA_STATUS,
            PackageInstaller.STATUS_FAILURE
        )

        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // The OS needs to show its own install-confirmation screen.
                // This is unavoidable for a normal (non-system, non-device-
                // owner) app — surface it so the user can tap through.
                @Suppress("DEPRECATION")
                val confirmIntent = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                confirmIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                confirmIntent?.let {
                    try {
                        context.startActivity(it)
                    } catch (e: Exception) {
                        Log.e(TAG, "Could not launch install confirmation screen", e)
                    }
                }
            }

            PackageInstaller.STATUS_SUCCESS -> {
                Log.i(TAG, "Install succeeded — relaunching app")
                val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
                launchIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                launchIntent?.let { context.startActivity(it) }
            }

            else -> {
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                Log.e(TAG, "Install failed (status=$status): $message")
                // Nothing else to do here — the app that triggered the
                // install is still running (the old version), so there's
                // no crash risk; the user just stays on the old build.
            }
        }
    }
}