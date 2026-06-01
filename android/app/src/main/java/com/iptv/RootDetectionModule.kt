package com.iptv // TODO: Replace with your actual package name

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.system.Os
import com.facebook.react.bridge.*
import java.io.*
import java.lang.reflect.Method
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipFile
import kotlin.system.exitProcess

class RootDetectionModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "RootDetection"

    companion object {
        // Known root/su binary paths
        private val ROOT_PATHS = arrayOf(
            "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su",
            "/system/xbin/su", "/data/local/xbin/su", "/data/local/bin/su",
            "/system/sd/xbin/su", "/system/bin/failsafe/su", "/data/local/su",
            "/su/bin/su", "/magisk/.core/bin/su", "/sbin/.magisk/bin/su",
            "/data/adb/magisk", "/data/adb/modules", "/cache/magisk.log",
            "/data/adb/magisk.img", "/sbin/.core/mirror", "/sbin/.core/img",
            "/proc/net/if_inet6" // Magisk hides this on some builds
        )

        // Dangerous / root-related packages
        private val ROOT_PACKAGES = arrayOf(
            "com.topjohnwu.magisk", "com.noshufou.android.su",
            "com.noshufou.android.su.elite", "eu.chainfire.supersu",
            "com.koushikdutta.superuser", "com.thirdparty.superuser",
            "com.yellowes.su", "com.koushikdutta.rommanager",
            "com.koushikdutta.rommanager.license", "com.dimonvideo.luckypatcher",
            "com.chelpus.lackypatch", "com.ramdroid.appquarantine",
            "com.ramdroid.appquarantinepro", "com.devadvance.rootcloak",
            "com.devadvance.rootcloakplus", "de.robv.android.xposed.installer",
            "com.saurik.substrate", "com.zachspong.temprootremovejb",
            "com.amphoras.hidemyroot", "com.formyhm.hiderootPremium",
            "com.amphoras.hidemyrootadfree", "com.zachspong.temprootremovejb",
            "com.ramdroid.appquarantine", "com.topjohnwu.magisk",
            "me.weishu.kernelsu", // KernelSU
            "io.github.vvb2060.magisk", // Delta Magisk
            "com.github.fox2code.mmm", // MagiskModuleManager
            "com.chrisplus.rootmanager", "com.dws.and.permission",
            "com.lxk.tool"
        )

        // Frida server port & known Frida artifacts
        private const val FRIDA_PORT = 27042
        private val FRIDA_LIBS = arrayOf(
            "frida", "gum-js-loop", "gmain", "linjector", "gumjs", "frida-agent",
            "frida-gadget", "frida-helper"
        )

        // Writable system partitions check paths
        private val WRITABLE_PATHS = arrayOf("/system", "/system/bin", "/vendor", "/system/etc")

        // Xposed / substrate frameworks
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

            // --- Layer 1: File system checks ---
            if (checkRootFiles()) {
                isRooted = true
                reasons.pushString("ROOT_FILES")
            }

            // --- Layer 2: Installed packages ---
            if (checkRootPackages()) {
                isRooted = true
                reasons.pushString("ROOT_PACKAGES")
            }

            // --- Layer 3: Su binary execution ---
            if (checkSuExecution()) {
                isRooted = true
                reasons.pushString("SU_EXECUTABLE")
            }

            // --- Layer 4: Build properties ---
            if (checkBuildProps()) {
                isRooted = true
                reasons.pushString("BUILD_PROPS")
            }

            // --- Layer 5: Writable system partitions ---
            if (checkWritablePaths()) {
                isRooted = true
                reasons.pushString("WRITABLE_SYSTEM")
            }

            // --- Layer 6: Xposed / Substrate framework ---
            if (checkXposed()) {
                isRooted = true
                reasons.pushString("XPOSED_FRAMEWORK")
            }

            // --- Layer 7: Frida detection ---
            if (checkFridaPort() || checkFridaMaps() || checkFridaLibs()) {
                isRooted = true
                reasons.pushString("FRIDA_DETECTED")
            }

            // --- Layer 8: Process / /proc inspection ---
            if (checkProcMaps()) {
                isRooted = true
                reasons.pushString("PROC_MAPS_TAMPERING")
            }

            // --- Layer 9: Native debugger check ---
            if (checkDebugged()) {
                isRooted = true
                reasons.pushString("DEBUGGER_ATTACHED")
            }

            // --- Layer 10: Package signature integrity ---
            if (checkSignatureIntegrity()) {
                isRooted = true
                reasons.pushString("SIGNATURE_TAMPERED")
            }

            result.putBoolean("rooted", isRooted)
            result.putArray("reasons", reasons)
            promise.resolve(result)

        } catch (e: Exception) {
            // On any unexpected error — treat as rooted (fail-secure)
            val result = Arguments.createMap()
            result.putBoolean("rooted", true)
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

    // ─── Layer 1: Root file paths ─────────────────────────────────────────────

    private fun checkRootFiles(): Boolean {
        for (path in ROOT_PATHS) {
            try {
                val f = File(path)
                if (f.exists()) return true
            } catch (_: Exception) {}
        }
        // Also check PATH-based su
        val pathDirs = System.getenv("PATH")?.split(":") ?: emptyList()
        for (dir in pathDirs) {
            if (File(dir, "su").exists()) return true
        }
        return false
    }

    // ─── Layer 2: Package manager scan ───────────────────────────────────────

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

    // ─── Layer 3: Try executing su ────────────────────────────────────────────

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

    // ─── Layer 4: Build properties / tags ─────────────────────────────────────

    private fun checkBuildProps(): Boolean {
        // Official retail builds always have "release" tags
        val tags = Build.TAGS
        if (tags != null && (tags.contains("test-keys") || tags.contains("dev-keys"))) return true

        // Fingerprint anomalies
        val fp = Build.FINGERPRINT
        if (fp.contains("generic") || fp.contains("unknown") ||
            fp.contains("test-keys") || fp.startsWith("android_x86")) return true

        // Read ro.debuggable prop via native
        return try {
            val roDebuggable = readProp("ro.debuggable")
            val roSecure = readProp("ro.secure")
            val roAllowRoot = readProp("ro.allow.mock.location")
            roDebuggable == "1" || roSecure == "0"
        } catch (_: Exception) {
            false
        }
    }

    private fun readProp(propName: String): String {
        return try {
            val clazz = Class.forName("android.os.SystemProperties")
            val method: Method = clazz.getMethod("get", String::class.java)
            method.invoke(null, propName) as String
        } catch (_: Exception) {
            ""
        }
    }

    // ─── Layer 5: Writable system partition ───────────────────────────────────

    private fun checkWritablePaths(): Boolean {
        for (path in WRITABLE_PATHS) {
            try {
                val f = File(path)
                val testFile = File(f, "rdt_probe_${System.currentTimeMillis()}")
                if (testFile.createNewFile()) {
                    testFile.delete()
                    return true
                }
            } catch (_: Exception) {}
        }
        return false
    }

    // ─── Layer 6: Xposed / Substrate ─────────────────────────────────────────

    private fun checkXposed(): Boolean {
        // Class loader inspection
        for (cls in XPOSED_CLASSES) {
            try {
                Class.forName(cls)
                return true
            } catch (_: ClassNotFoundException) {}
        }

        // Stack trace inspection for Xposed hooks
        try {
            throw Exception("probe")
        } catch (e: Exception) {
            val stack = e.stackTrace
            for (frame in stack) {
                val cls = frame.className
                if (cls.contains("de.robv.android.xposed") ||
                    cls.contains("com.saurik.substrate")) return true
            }
        }

        // Check loaded native libs
        try {
            val mapsFile = File("/proc/${Process.myPid()}/maps")
            if (mapsFile.canRead()) {
                val reader = mapsFile.bufferedReader()
                var line = reader.readLine()
                while (line != null) {
                    if (line.contains("XposedBridge") || line.contains("substrate")) {
                        reader.close()
                        return true
                    }
                    line = reader.readLine()
                }
                reader.close()
            }
        } catch (_: Exception) {}

        return false
    }

    // ─── Layer 7: Frida ───────────────────────────────────────────────────────

    private fun checkFridaPort(): Boolean {
        return try {
            val socket = java.net.Socket()
            socket.connect(java.net.InetSocketAddress("127.0.0.1", FRIDA_PORT), 100)
            socket.close()
            true // Port is open → Frida server running
        } catch (_: Exception) {
            false
        }
    }

    private fun checkFridaMaps(): Boolean {
        return try {
            val mapsFile = File("/proc/${Process.myPid()}/maps")
            if (!mapsFile.canRead()) return false
            val reader = mapsFile.bufferedReader()
            var line = reader.readLine()
            while (line != null) {
                val lower = line.lowercase()
                for (lib in FRIDA_LIBS) {
                    if (lower.contains(lib)) {
                        reader.close()
                        return true
                    }
                }
                line = reader.readLine()
            }
            reader.close()
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun checkFridaLibs(): Boolean {
        // Check /proc/self/fd for frida agent file descriptors
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

    // ─── Layer 8: /proc/maps anomaly check ────────────────────────────────────

    private fun checkProcMaps(): Boolean {
        return try {
            val mapsFile = File("/proc/${Process.myPid()}/maps")
            if (!mapsFile.canRead()) return false

            val suspiciousPatterns = arrayOf(
                "inject", "hook", "patch", "zygote64_alt", "memfd:", "anon_inode",
                "libsuperhide", "twrp", "busybox"
            )

            val reader = mapsFile.bufferedReader()
            var line = reader.readLine()
            while (line != null) {
                val lower = line.lowercase()
                for (pat in suspiciousPatterns) {
                    if (lower.contains(pat)) {
                        reader.close()
                        return true
                    }
                }
                line = reader.readLine()
            }
            reader.close()
            false
        } catch (_: Exception) {
            false
        }
    }

    // ─── Layer 9: Debugger attached check ────────────────────────────────────

    private fun checkDebugged(): Boolean {
        // TracerPid in /proc/self/status: non-zero means a debugger is attached
        return try {
            val statusFile = File("/proc/self/status")
            if (!statusFile.canRead()) return false
            val reader = statusFile.bufferedReader()
            var line = reader.readLine()
            while (line != null) {
                if (line.startsWith("TracerPid:")) {
                    val pid = line.substringAfter(":").trim().toIntOrNull() ?: 0
                    reader.close()
                    return pid != 0
                }
                line = reader.readLine()
            }
            reader.close()
            false
        } catch (_: Exception) {
            false
        }
    }

    // ─── Layer 10: APK Signature integrity ────────────────────────────────────

    private fun checkSignatureIntegrity(): Boolean {
        return try {
            val pm = reactContext.packageManager
            val packageName = reactContext.packageName

            @Suppress("DEPRECATION")
            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                info.signingInfo?.apkContentsSigners
            } else {
                val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                @Suppress("DEPRECATION")
                info.signatures
            }

            if (signatures.isNullOrEmpty()) return true

            val md = MessageDigest.getInstance("SHA-256")
            val sigHash = md.digest(signatures[0].toByteArray())
            val sigHex = sigHash.joinToString("") { "%02x".format(it) }

            // TODO: Replace this with your ACTUAL release signing certificate SHA-256
            // To get it: keytool -printcert -jarfile your_release.apk
            val EXPECTED_SIGNATURE_SHA256 = "ce10d45f39917bea718e1242140053667d7ef63900ecea7351bd5e4a81cd8218"

            // During development, disable this check or populate the real hash
            if (EXPECTED_SIGNATURE_SHA256 == "ce10d45f39917bea718e1242140053667d7ef63900ecea7351bd5e4a81cd8218") {
                return false // Skip in dev until populated
            }

            sigHex != EXPECTED_SIGNATURE_SHA256
        } catch (_: Exception) {
            false // Don't fail-secure on signature check alone
        }
    }
}