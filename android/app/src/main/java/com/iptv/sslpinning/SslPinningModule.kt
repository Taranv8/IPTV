package com.iptv.sslpinning

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

import android.os.Handler
import android.os.Looper
import android.os.Process
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.Response as OkResponse
import com.facebook.react.bridge.*
import okhttp3.*
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import javax.net.ssl.*

/**
 * SslPinningModule
 *
 * Responsibilities:
 *  1. Dynamic SSL pinning — pin hashes are fetched from Firebase Remote Config
 *     (never hardcoded). Call setPins() before any network call.
 *  2. MITM proxy detection — checks installed packages, proxy settings, and
 *     well-known interception tool port signatures.
 *  3. Instrumentation / reverse-engineering tool detection — Frida, Burp cert
 *     in trust store, Xposed (augments rootDetection module).
 */
class SslPinningModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        // ── MITM apps — package names of common interception tools ─────────
        private val KNOWN_MITM_PACKAGES = listOf(
            "com.schiller.httpcanary",          // HTTP Canary
            "app.greyshirts.sslcapture",        // SSL Capture
            "com.httptoolkit.android",           // HTTP Toolkit
            "com.minhui.networkcapture",         // Network Capture
            "info.alphasoftware.pcapdroid",      // PCAPdroid
            "pcapdroid.test",
            "com.packetcapture.wireshark",
            "com.taobao.android.tao",            // some proxy wrappers
            "org.sandroproxy.drony",             // Drony
            "com.ddnstone.proxydroid",           // ProxyDroid
            "org.proxydroid",
            "com.burpsuite",                     // Burp companion (rare)
            "com.charles",                       // Charles (rare on device)
            "com.fiddler.mobile",                // Fiddler
            "eu.faircode.netguard",              // NetGuard (can proxy traffic)
            "com.wifi.analyzer",
            "tw.ne.free.wireshark"
        )

        // ── Frida / reverse-engineering artifacts ───────────────────────────
        private val FRIDA_INDICATORS = listOf(
            "/data/local/tmp/frida-server",
            "/data/local/tmp/re.frida.server",
            "/data/local/tmp/frida-agent.so",
            "/sdcard/frida-server",
            "/system/xbin/frida-server"
        )

        private val FRIDA_PACKAGES = listOf(
            "re.frida.server",
            "com.nds.charles"
        )

        // TCP ports commonly used by interception proxies
        private val KNOWN_PROXY_PORTS = listOf(8080, 8888, 9090, 10800, 1234, 4444, 8118)

private const val PING_INTERVAL_SEC = 10L
private const val MAX_RECONNECT_MS  = 30_000L
    }

    // Live pin set — filled by JS via setPins()
    @Volatile
    private var currentPins: Set<String> = emptySet()

    // Cached OkHttpClient rebuilt when pins change
    @Volatile
    private var pinnedClient: OkHttpClient? = null
@Volatile private var currentWsUrl: String = ""
@Volatile private var watchSocket: WebSocket? = null
@Volatile private var watchClient: OkHttpClient? = null
@Volatile private var pinWatchActive = false
private var reconnectDelayMs = 1_000L
private val reconnectHandler = Handler(Looper.getMainLooper())
    override fun getName() = "SslPinningModule"

    // ─────────────────────────────────────────────────────────────────────────
    // JS-callable: receive pins from Remote Config and rebuild the HTTP client
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Called from JS after Remote Config delivers the pin set.
     *
     * @param pinsArray  ReadableArray of SHA-256 SPKI hashes, base64-encoded,
     *                   e.g. ["sha256/AAAA…=", "sha256/BBBB…="]
     * @param promise    resolves true on success, rejects on bad input
     */
    @ReactMethod
    fun setPins(pinsArray: ReadableArray, promise: Promise) {
        try {
            val pins = mutableSetOf<String>()
            for (i in 0 until pinsArray.size()) {
                val pin = pinsArray.getString(i) ?: continue
                // Accept both "sha256/BASE64==" and bare "BASE64==" formats
                if (pin.isNotBlank()) pins.add(pin.trim())
            }
            if (pins.isEmpty()) {
                promise.reject("EMPTY_PINS", "Pin set must not be empty")
                return
            }
            currentPins = pins
            pinnedClient = buildPinnedClient(pins)
            // Push the new client into the factory so RN's fetch() uses it too
PinnedOkHttpClientFactory.updateClient(pinnedClient!!)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PIN_SETUP_ERROR", e.message, e)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS-callable: validate a URL against the pinned client
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Performs a HEAD request to [url] using the pinned OkHttpClient.
     * Returns true if TLS handshake succeeds with the pinned cert.
     */
    @ReactMethod
    fun validatePin(url: String, promise: Promise) {
        val client = pinnedClient
        if (client == null) {
            promise.reject("PINS_NOT_SET", "Call setPins() before validatePin()")
            return
        }
        try {
            val request = Request.Builder().url(url).head().build()
            client.newCall(request).execute().use { response ->
                promise.resolve(response.isSuccessful || response.code in 301..308)
            }
        } catch (e: SSLPeerUnverifiedException) {
            promise.reject("PIN_MISMATCH", "Certificate pin mismatch: ${e.message}", e)
        } catch (e: Exception) {
            promise.reject("VALIDATION_ERROR", e.message, e)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS-callable: full MITM + tool detection sweep
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Runs all interception-tool checks and returns a WritableMap:
     *   { detected: Boolean, reasons: Array<String>, packages: Array<String> }
     */
    @ReactMethod
    fun detectMitmTools(promise: Promise) {
        try {
            val reasons = mutableListOf<String>()
            val detectedPackages = mutableListOf<String>()

            // 1. Installed MITM packages
            val pm = reactContext.packageManager
            for (pkg in KNOWN_MITM_PACKAGES) {
                if (isPackageInstalled(pm, pkg)) {
                    reasons.add("MITM_PACKAGE_INSTALLED")
                    detectedPackages.add(pkg)
                }
            }

            // 2. Frida file artifacts
            if (FRIDA_INDICATORS.any { File(it).exists() }) {
                reasons.add("FRIDA_FILES_FOUND")
            }

            // 3. Frida packages
            for (pkg in FRIDA_PACKAGES) {
                if (isPackageInstalled(pm, pkg)) {
                    reasons.add("FRIDA_PACKAGE_INSTALLED")
                    detectedPackages.add(pkg)
                }
            }

            // 4. Frida port probe (default 27042)
            if (isTcpPortOpen("127.0.0.1", 27042)) {
                reasons.add("FRIDA_PORT_OPEN")
            }

            // 5. System proxy pointing to loopback / non-standard port
            val proxyHost = System.getProperty("http.proxyHost") ?: ""
            val proxyPort = System.getProperty("http.proxyPort")?.toIntOrNull() ?: -1
            if (proxyHost.isNotEmpty()) {
                val suspicious = proxyHost == "127.0.0.1" || proxyHost == "localhost" ||
                        proxyPort in KNOWN_PROXY_PORTS
                if (suspicious) reasons.add("SUSPICIOUS_PROXY_SETTING")
            }

            // 6. Known proxy ports open on loopback
            for (port in KNOWN_PROXY_PORTS) {
                if (isTcpPortOpen("127.0.0.1", port)) {
                    reasons.add("PROXY_PORT_OPEN:$port")
                }
            }

            // 7. Burp / Charles / mitmproxy CA in user trust store
            if (hasUntrustedSystemCa()) {
                reasons.add("UNTRUSTED_CA_IN_SYSTEM_STORE")
            }

            val result = Arguments.createMap().apply {
                putBoolean("detected", reasons.isNotEmpty())
                putArray("reasons", Arguments.fromList(reasons))
                putArray("packages", Arguments.fromList(detectedPackages))
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("DETECTION_ERROR", e.message, e)
        }
    }
@ReactMethod
fun startPinWatch(wsUrl: String, promise: Promise) {
    val base = pinnedClient
    if (base == null) {
        promise.reject("PINS_NOT_SET", "Call setPins() before startPinWatch()")
        return
    }
    if (wsUrl.isBlank()) {
        promise.reject("INVALID_URL", "wsUrl must not be empty")
        return
    }
    stopPinWatchInternal()
    currentWsUrl = wsUrl
    watchClient = base.newBuilder()
        .pingInterval(PING_INTERVAL_SEC, TimeUnit.SECONDS)
        .build()
    pinWatchActive = true
    reconnectDelayMs = 1_000L
    openSocket()
    promise.resolve(true)
}

@ReactMethod
fun stopPinWatch(promise: Promise) {
    stopPinWatchInternal()
    promise.resolve(true)
}

private fun stopPinWatchInternal() {
    pinWatchActive = false
    reconnectHandler.removeCallbacksAndMessages(null)
    watchSocket?.close(1000, "paused")
    watchSocket = null
}

private fun openSocket() {
    val client = watchClient ?: return
    if (currentWsUrl.isBlank()) return
    client.newWebSocket(
        Request.Builder().url(currentWsUrl).build(),
        PinWatchListener()
    )
}

private inner class PinWatchListener : WebSocketListener() {
    override fun onOpen(webSocket: WebSocket, response: OkResponse) {
        watchSocket = webSocket
        reconnectDelayMs = 1_000L
    }
    override fun onFailure(webSocket: WebSocket, t: Throwable, response: OkResponse?) {
        watchSocket = null
        if (t is SSLPeerUnverifiedException) {
            killForMitm(t.message ?: "pin mismatch")
        } else {
            if (pinWatchActive) scheduleReconnect()
        }
    }
    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        webSocket.close(1000, null)
        watchSocket = null
        if (pinWatchActive) scheduleReconnect()
    }
}

private fun scheduleReconnect() {
    reconnectHandler.postDelayed({ if (pinWatchActive) openSocket() }, reconnectDelayMs)
    reconnectDelayMs = minOf(reconnectDelayMs * 2, MAX_RECONNECT_MS)
}

private fun killForMitm(reason: String) {
    try {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("SslPinMismatchDetected", reason)
    } catch (_: Exception) {}
    Handler(Looper.getMainLooper()).postDelayed({
        Process.killProcess(Process.myPid())
    }, 150)
}
    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

 private fun buildPinnedClient(pins: Set<String>): OkHttpClient {
    val normalisedPins = pins.map { if (it.startsWith("sha256/")) it else "sha256/$it" }

    val pinnerBuilder = CertificatePinner.Builder()
    for (pin in normalisedPins) {
        pinnerBuilder.add("*.railway.app", pin)
        pinnerBuilder.add("iptv-backend-production-fe47.up.railway.app", pin)
    }

    val trustManager = buildPinningTrustManager(pins)
    val sslContext = SSLContext.getInstance("TLS")
    sslContext.init(null, arrayOf(trustManager), java.security.SecureRandom())

    // ✅ Plain builder here — OkHttpClientProvider belongs only in
    // PinnedOkHttpClientFactory, not here
    return OkHttpClient.Builder()
        .certificatePinner(pinnerBuilder.build())
        .sslSocketFactory(sslContext.socketFactory, trustManager)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()
}

private fun buildPinningTrustManager(pins: Set<String>): X509TrustManager {
    val defaultTm = run {
        val tmFactory = javax.net.ssl.TrustManagerFactory.getInstance(
            javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm()
        )
        tmFactory.init(null as java.security.KeyStore?)
        tmFactory.trustManagers.filterIsInstance<X509TrustManager>().first()
    }

    return object : X509TrustManager {
        override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> =
            defaultTm.acceptedIssuers

        override fun checkClientTrusted(
            chain: Array<java.security.cert.X509Certificate>, authType: String
        ) = defaultTm.checkClientTrusted(chain, authType)

        override fun checkServerTrusted(
            chain: Array<java.security.cert.X509Certificate>, authType: String
        ) {
            defaultTm.checkServerTrusted(chain, authType)
            // Verify SPKI pin against each cert in chain

        }
    }
}

    private fun isPackageInstalled(pm: PackageManager, packageName: String): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(packageName, 0)
            }
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    /**
     * Non-blocking TCP probe with a very short timeout.
     * Returns true if the port accepts a connection.
     */
    private fun isTcpPortOpen(host: String, port: Int, timeoutMs: Int = 300): Boolean {
        return try {
            Socket().use { socket ->
                socket.soTimeout = timeoutMs
                socket.connect(InetSocketAddress(host, port), timeoutMs)
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Heuristic: look for CA certificates installed by the user
     * (in the user trust store) which is a common Burp/Charles/mitmproxy setup.
     * On Android 7+ user certs are in /data/misc/user/0/cacerts-added/.
     */
    private fun hasUntrustedSystemCa(): Boolean {
        return try {
            val userCaDir = File("/data/misc/user/0/cacerts-added")
            userCaDir.exists() && (userCaDir.listFiles()?.isNotEmpty() == true)
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Expose the current pinned OkHttpClient to other native modules that
     * need to make secure requests (e.g., a custom streaming module).
     */
    fun getPinnedClient(): OkHttpClient? = pinnedClient
}
