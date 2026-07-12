package com.iptv.apkinstaller
// TODO: replace "com.rubytv" above with your app's actual applicationId / package,
// and move this file to android/app/src/main/java/<your/package/path>/apkinstaller/

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream

class ApkInstallerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ApkInstaller"

    /**
     * Whether this app currently has permission to install packages from
     * outside the Play Store ("install unknown apps" / "unknown sources").
     * On API < 26 this permission doesn't exist per-app (it was a single
     * global toggle), so we report true and let the OS handle it.
     */
    @ReactMethod
    fun canRequestPackageInstalls(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.packageManager.canRequestPackageInstalls()
            } else {
                true
            }
            promise.resolve(allowed)
        } catch (e: Exception) {
            promise.reject("ERR_CHECK_PERMISSION", e)
        }
    }

    /**
     * Opens the OS settings screen where the user flips "Allow from this
     * source" on for this app. There is no way to grant this permission
     * programmatically — Android requires the user to do it manually here.
     */
    @ReactMethod
    fun openUnknownSourcesSettings(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${ctx.packageName}")
                }
            } else {
                Intent(Settings.ACTION_SECURITY_SETTINGS)
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_OPEN_SETTINGS", e)
        }
    }

    /**
     * Returns the versionCode (API < 28) / longVersionCode (API >= 28) of
     * the currently-installed build, as a string (avoids float-precision
     * issues crossing the JS bridge).
     */
    @ReactMethod
    fun getInstalledVersionCode(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val pInfo = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
            val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }
            promise.resolve(versionCode.toString())
        } catch (e: Exception) {
            promise.reject("ERR_VERSION_CODE", e)
        }
    }

    /**
     * Streams the given APK file into a new PackageInstaller session and
     * commits it. This resolves once the session is committed — NOT once
     * the install actually finishes. Final success/failure (and, on
     * success, relaunching the app) is handled by ApkInstallReceiver.
     *
     * IMPORTANT: On most consumer devices, Android will still show its own
     * install-confirmation screen at this point — that's an OS security
     * boundary this module cannot bypass for a normal app. See the notes
     * in src/native/ApkInstaller.ts and android/README.md for what would
     * be needed for a fully silent install (Device Owner / system app).
     */
    @ReactMethod
    fun installApk(filePath: String, promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val file = File(filePath)
            if (!file.exists()) {
                promise.reject("ERR_FILE_MISSING", "APK file not found at $filePath")
                return
            }

            val packageInstaller = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Only actually skips the confirmation UI when this app was
                // the installer of record for the currently-running version
                // and the OEM/API level supports it. Safe to set regardless.
                params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }

            val sessionId = packageInstaller.createSession(params)
            val session = packageInstaller.openSession(sessionId)

            FileInputStream(file).use { input ->
                session.openWrite("update", 0, file.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }

            val intent = Intent(ctx, ApkInstallReceiver::class.java).apply {
                action = ApkInstallReceiver.ACTION_INSTALL_COMPLETE
            }
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_MUTABLE
            } else {
                0
            }
            val pendingIntent = PendingIntent.getBroadcast(ctx, sessionId, intent, flags)

            session.commit(pendingIntent.intentSender)
            session.close()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_INSTALL", e)
        }
    }
}