package com.iptv.sslpinning

import com.facebook.react.modules.network.OkHttpClientFactory
import okhttp3.OkHttpClient
import okhttp3.HttpUrl
import javax.net.ssl.SSLPeerUnverifiedException
import java.util.concurrent.TimeUnit

/**
 * PinnedOkHttpClientFactory
 *
 * Replaces React Native's default OkHttpClient so that ALL network calls
 * made from JS (fetch, XMLHttpRequest, axios) go through a pinned client.
 *
 * Installed early in MainApplication.onCreate() BEFORE super.onCreate(),
 * so no unverified request can escape during the startup window.
 *
 * Before setPins() is called (i.e. before Remote Config delivers real pins),
 * all requests are blocked EXCEPT Firebase / Google domains, which must be
 * allowed through so that Remote Config can fetch the pin hashes in the
 * first place.
 *
 * Once SslPinningModule.setPins() is called from JS, updateClient() replaces
 * the startup blocker with the real certificate-pinned OkHttpClient.
 */
class PinnedOkHttpClientFactory : OkHttpClientFactory {

    companion object {

        @Volatile
        private var activeClient: OkHttpClient? = null

        /**
         * Called by SslPinningModule.setPins() after Remote Config delivers
         * the real pin set. Replaces the startup blocking client with the
         * fully pinned live client.
         */
        fun updateClient(client: OkHttpClient) {
            activeClient = client
        }

        /**
         * Domains that must be reachable BEFORE pins arrive.
         * Firebase Remote Config, Firebase Installations, and the Google
         * APIs umbrella are required for RC to fetch the ssl_pins value.
         *
         * These are allowed through using the system CA trust store only
         * (no certificate pinning). This is acceptable because:
         *   - RC delivers pin hashes, not user secrets
         *   - validatePin() against the real backend runs immediately after,
         *     catching any RC-level MITM attempt
         *   - MITM detection sweep runs before RC is even fetched
         */
        private val FIREBASE_ALLOWED_SUFFIXES = listOf(
            "firebaseremoteconfig.googleapis.com",
            "firebaseinstallations.googleapis.com",
            "firebaselogging.googleapis.com",
            "firebase.googleapis.com",
            "googleapis.com",
            "gstatic.com",
            "google.com"
        )

        private fun isAllowedPrePinHost(url: HttpUrl): Boolean {
            val host = url.host.lowercase()
            return FIREBASE_ALLOWED_SUFFIXES.any { suffix ->
                host == suffix || host.endsWith(".$suffix")
            }
        }

        /**
         * Startup blocking client — used before real pins arrive from RC.
         *
         * Uses an interceptor (not CertificatePinner) because:
         *   - CertificatePinner.Builder().add("*", ...) is rejected by
         *     OkHttp 4.x with IllegalArgumentException at construction time
         *   - An interceptor lets us selectively allow Firebase traffic
         *     through while blocking everything else
         */
        private fun buildBlockingClient(): OkHttpClient {
            return OkHttpClient.Builder()
                .addInterceptor { chain ->
                    val request = chain.request()
                    if (isAllowedPrePinHost(request.url)) {
                        // Firebase / Google — allow through on system CAs
                        chain.proceed(request)
                    } else {
                        // Everything else is blocked until real pins arrive
                        throw SSLPeerUnverifiedException(
                            "SSL pinning not yet initialised. " +
                            "Request to '${request.url.host}' blocked " +
                            "until Remote Config delivers pin hashes."
                        )
                    }
                }
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .writeTimeout(20, TimeUnit.SECONDS)
                .build()
        }
    }

    override fun createNewNetworkModuleClient(): OkHttpClient {
        // If real pins have arrived, use the fully pinned client.
        // Otherwise use the startup blocker so nothing unverified leaks.
        return activeClient ?: buildBlockingClient()
    }
}