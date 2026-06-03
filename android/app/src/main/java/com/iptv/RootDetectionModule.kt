





package com.iptv

import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.system.Os
import com.facebook.react.bridge.*
import java.io.*
import java.security.MessageDigest
import kotlin.system.exitProcess

class RootDetectionModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "RootDetection"

    companion object {
        // ── Layer 1: High-confidence root/Magisk file paths ──────────────────
        // Only paths that are 100% absent on any legitimate stock ROM.
        // Removed borderline paths that some OEM stock ROMs include.
        private val ROOT_PATHS = arrayOf(
            // Classic su binaries — not present on any unrooted stock ROM
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/data/local/su",
            "/su/bin/su",
            // Magisk-specific artifacts — conclusive evidence of Magisk
            "/magisk/.core/bin/su",
            "/sbin/.magisk/bin/su",
            "/data/adb/magisk",          // Magisk data directory
            "/data/adb/modules",         // Magisk modules directory
            "/cache/magisk.log",         // Magisk log file
            "/data/adb/magisk.img",      // Magisk image
            "/sbin/.core/mirror",        // Old Magisk mirror mount
            "/sbin/.core/img",           // Old Magisk image mount
        )

        // ── Layer 2: Root management app packages ────────────────────────────
        // A matching installed package is definitive — no stock ROM ships these.
        private val ROOT_PACKAGES = arrayOf(
            "com.topjohnwu.magisk",               // Magisk
            "com.noshufou.android.su",            // SuperUser
            "com.noshufou.android.su.elite",
            "eu.chainfire.supersu",               // SuperSU
            "com.koushikdutta.superuser",
            "com.thirdparty.superuser",
            "com.yellowes.su",
            "com.koushikdutta.rommanager",
            "com.koushikdutta.rommanager.license",
            "com.devadvance.rootcloak",           // Root-hiding tools
            "com.devadvance.rootcloakplus",
            "com.amphoras.hidemyroot",
            "com.formyhm.hiderootPremium",
            "com.amphoras.hidemyrootadfree",
            "de.robv.android.xposed.installer",   // Xposed
            "com.saurik.substrate",               // Cydia Substrate
            "me.weishu.kernelsu",                 // KernelSU
            "io.github.vvb2060.magisk",           // Delta Magisk
            "com.github.fox2code.mmm",            // Magisk Module Manager
            "com.dimonvideo.luckypatcher",        // Lucky Patcher
            "com.chelpus.lackypatch",
            "com.ramdroid.appquarantine",
            "com.ramdroid.appquarantinepro",
        )

        // ── Layer 7: Frida artifacts ──────────────────────────────────────────
        private const val FRIDA_PORT = 27042
        private val FRIDA_LIBS = arrayOf(
            "frida-agent", "frida-gadget", "frida-helper",
            "gum-js-loop", "gumjs", "linjector"
            // Removed generic names like "frida", "gmain" that could
            // theoretically match innocent strings in unrelated paths.
        )

        // ── Layer 6: Xposed / Substrate class names ───────────────────────────
        private val XPOSED_CLASSES = arrayOf(
            "de.robv.android.xposed.XposedBridge",
            "de.robv.android.xposed.XposedHelpers",
            "de.robv.android.xposed.callbacks.XC_MethodReplacement",
            "com.saurik.substrate.MS"
        )
    }

    // ─── Public JS-exposed method ─────────────────────────────────────────────

    @ReactMethod
    fun isRooted(promise: Promise) {
        try {
            val result = Arguments.createMap()
            var isRooted = false
            val reasons = Arguments.createArray()

            // Layer 1: Definitive root file / Magisk artifact presence
            if (checkRootFiles()) {
                isRooted = true
                reasons.pushString("ROOT_FILES")
            }

            // Layer 2: Root management app installed
            if (checkRootPackages()) {
                isRooted = true
                reasons.pushString("ROOT_PACKAGES")
            }

            // Layer 3: su binary is executable from known locations
            if (checkSuExecution()) {
                isRooted = true
                reasons.pushString("SU_EXECUTABLE")
            }

            // Layer 6: Xposed / Substrate hook framework loaded
            if (checkXposed()) {
                isRooted = true
                reasons.pushString("XPOSED_FRAMEWORK")
            }

            // Layer 7: Frida dynamic instrumentation (port + maps + fd scan)
            if (checkFridaPort() || checkFridaMaps() || checkFridaLibs()) {
                isRooted = true
                reasons.pushString("FRIDA_DETECTED")
            }

            // Layer 10: APK signing certificate mismatch (enable once hash is set)
            if (checkSignatureIntegrity()) {
                isRooted = true
                reasons.pushString("SIGNATURE_TAMPERED")
            }

            result.putBoolean("rooted", isRooted)
            result.putArray("reasons", reasons)
            promise.resolve(result)

        } catch (e: Exception) {
            // Fail-secure: unexpected errors are treated as a detection failure,
            // NOT as a root indicator, to avoid false positives on weird OEM ROMs.
            val result = Arguments.createMap()
            result.putBoolean("rooted", false)
            result.putString("error", e.message)
            promise.resolve(result)
        }
    }

    @ReactMethod
    fun killApp(promise: Promise) {
        try {
            reactContext.currentActivity?.finishAffinity()
            Process.killProcess(Process.myPid())
            exitProcess(1)
        } catch (e: Exception) {
            exitProcess(1)
        }
    }

    // ─── Layer 1: Root file / Magisk artifact check ───────────────────────────

    private fun checkRootFiles(): Boolean {
        for (path in ROOT_PATHS) {
            try {
                if (File(path).exists()) return true
            } catch (_: Exception) {}
        }
        // Also scan each directory on $PATH for a reachable su binary
        val pathDirs = System.getenv("PATH")?.split(":") ?: emptyList()
        for (dir in pathDirs) {
            try {
                if (File(dir, "su").exists()) return true
            } catch (_: Exception) {}
        }
        return false
    }

    // ─── Layer 2: Installed root package scan ────────────────────────────────

    private fun checkRootPackages(): Boolean {
        val pm = reactContext.packageManager
        for (pkg in ROOT_PACKAGES) {
            try {
                pm.getPackageInfo(pkg, PackageManager.GET_ACTIVITIES)
                return true
            } catch (_: PackageManager.NameNotFoundException) {}
        }
        return false
    }

    // ─── Layer 3: Try resolving/executing su ─────────────────────────────────

    private fun checkSuExecution(): Boolean {
        return try {
            val process = Runtime.getRuntime().exec(arrayOf("/system/xbin/which", "su"))
            val br = BufferedReader(InputStreamReader(process.inputStream))
            val result = br.readLine()
            process.destroy()
            !result.isNullOrBlank()
        } catch (_: Exception) {
            false
        }
    }

    // ─── Layer 6: Xposed / Substrate framework detection ─────────────────────

    private fun checkXposed(): Boolean {
        // 1. Try loading known Xposed/Substrate classes directly
        for (cls in XPOSED_CLASSES) {
            try {
                Class.forName(cls)
                return true
            } catch (_: ClassNotFoundException) {}
        }
        // 2. Inspect the current stack trace for hook framework frames
        try {
            throw Exception("probe")
        } catch (e: Exception) {
            for (frame in e.stackTrace) {
                val cls = frame.className
                if (cls.contains("de.robv.android.xposed") ||
                    cls.contains("com.saurik.substrate")) return true
            }
        }
        // 3. Check /proc/maps for Xposed/Substrate shared libraries
        try {
            val mapsFile = File("/proc/${Process.myPid()}/maps")
            if (mapsFile.canRead()) {
                mapsFile.bufferedReader().use { reader ->
                    reader.lineSequence().forEach { line ->
                        if (line.contains("XposedBridge") ||
                            line.contains("substrate")) return true
                    }
                }
            }
        } catch (_: Exception) {}
        return false
    }

    // ─── Layer 7a: Frida server listening on its default port ────────────────

    private fun checkFridaPort(): Boolean {
        return try {
            val socket = java.net.Socket()
            socket.connect(java.net.InetSocketAddress("127.0.0.1", FRIDA_PORT), 100)
            socket.close()
            true
        } catch (_: Exception) {
            false
        }
    }

    // ─── Layer 7b: Frida libraries in /proc/maps ──────────────────────────────

    private fun checkFridaMaps(): Boolean {
        return try {
            val mapsFile = File("/proc/${Process.myPid()}/maps")
            if (!mapsFile.canRead()) return false
            mapsFile.bufferedReader().use { reader ->
                reader.lineSequence().forEach { line ->
                    val lower = line.lowercase()
                    for (lib in FRIDA_LIBS) {
                        if (lower.contains(lib)) return true
                    }
                }
            }
            false
        } catch (_: Exception) {
            false
        }
    }

    // ─── Layer 7c: Frida file descriptors open ────────────────────────────────

    private fun checkFridaLibs(): Boolean {
        return try {
            val fdDir = File("/proc/self/fd")
            val fds = fdDir.listFiles() ?: return false
            for (fd in fds) {
                try {
                    val link = Os.readlink(fd.absolutePath)
                    if (FRIDA_LIBS.any { link.contains(it, ignoreCase = true) }) return true
                } catch (_: Exception) {}
            }
            false
        } catch (_: Exception) {
            false
        }
    }

    // ─── Layer 10: APK signing certificate integrity ──────────────────────────
    //
    // HOW TO GET YOUR HASH:
    //   keytool -printcert -jarfile your_release.apk
    // Then paste the SHA-256 fingerprint below (lowercase, no colons).
    //
    // This check is DISABLED until you replace the placeholder hash below.

    private fun checkSignatureIntegrity(): Boolean {
        return try {
            val EXPECTED_SHA256 = "ce10d45f39917bea718e1242140053667d7ef63900ecea7351bd5e4a81cd8218"

            // Guard: if placeholder is still set, skip this check entirely.
            if (EXPECTED_SHA256.startsWith("REPLACE_")) return false

            val pm = reactContext.packageManager
            val packageName = reactContext.packageName

            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                    .signingInfo?.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES).signatures
            }

            if (signatures.isNullOrEmpty()) return true

            val md = MessageDigest.getInstance("SHA-256")
            val sigHex = md.digest(signatures[0].toByteArray())
                .joinToString("") { "%02x".format(it) }

            sigHex != EXPECTED_SHA256
        } catch (_: Exception) {
            // If the signature check itself throws, don't block the user.
            false
        }
    }
}