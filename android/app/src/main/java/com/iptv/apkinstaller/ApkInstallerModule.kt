package com.iptv.apkinstaller

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

class ApkInstallerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ApkInstaller"

    // ── Permission check / settings redirect / versionCode — unchanged ──────

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

    // ── APK download — NEW: replaces RNFS.downloadFile for this flow ────────
    //
    // Plain HttpURLConnection, no react-native-fs involved anywhere in this
    // path. Every failure path below rejects with an explicit, non-null
    // string code — the exact thing react-native-fs's Downloader.java gets
    // wrong (it can call promise.reject(null, ...), which crashes the app
    // on newer RN's Kotlin bridge instead of just failing the promise).
    //
    // Progress is streamed to JS as "ApkDownloadProgress" events rather than
    // returned via the (single-shot) promise. Subscribe on the JS side with
    // a NativeEventEmitter — see ApkInstaller.ts.
    @ReactMethod
    fun downloadApk(urlString: String, destPath: String, promise: Promise) {
        Thread {
            var connection: HttpURLConnection? = null
            try {
                val url = URL(urlString)
                connection = (url.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15000
                    readTimeout = 15000
                    instanceFollowRedirects = true // handles 301/302/307/308 automatically
                }
                connection.connect()

                val status = connection.responseCode
                if (status < 200 || status >= 300) {
                    promise.reject("ERR_HTTP_STATUS", "APK download failed — HTTP $status")
                    return@Thread
                }

                val contentLength = connection.contentLengthLong // -1 if server omits it
                val destFile = File(destPath)
                destFile.parentFile?.mkdirs()
                if (destFile.exists()) destFile.delete()

                var bytesWritten = 0L
                var lastEmit = 0L

                BufferedInputStream(connection.inputStream, 8 * 1024).use { input ->
                    FileOutputStream(destFile).use { output ->
                        val buffer = ByteArray(8 * 1024)
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            output.write(buffer, 0, read)
                            bytesWritten += read
                            val now = System.currentTimeMillis()
                            if (now - lastEmit > 200) {
                                lastEmit = now
                                emitProgress(bytesWritten, contentLength)
                            }
                        }
                        output.flush()
                    }
                }
                emitProgress(bytesWritten, contentLength) // guarantee a final 100% event

                promise.resolve(null)
            } catch (e: Exception) {
                // Always a real string code — this is the whole point of
                // rewriting this instead of relying on react-native-fs.
                promise.reject("ERR_DOWNLOAD", e.message ?: "APK download failed")
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    private fun emitProgress(bytesWritten: Long, contentLength: Long) {
        val params: WritableMap = Arguments.createMap().apply {
            putDouble("bytesWritten", bytesWritten.toDouble())
            putDouble("contentLength", contentLength.toDouble())
        }
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("ApkDownloadProgress", params)
    }

    // ── APK install — unchanged from before ──────────────────────────────
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