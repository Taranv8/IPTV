package com.iptv.sslpinning

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.CertificatePinner
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Replaces React Native's default OkHttpClient so that ALL network calls
 * made from JS (fetch, XMLHttpRequest, axios) go through a pinned client.
 *
 * This factory holds a static reference to the latest pinned client.
 * SslPinningModule calls PinnedOkHttpClientFactory.updateClient(newClient)
 * every time setPins() is called from JS (i.e. after Remote Config loads).
 *
 * Before setPins() is called the first time, RN network calls are blocked
 * entirely by using a client with an impossible pin — this is intentional.
 */
class PinnedOkHttpClientFactory : OkHttpClientFactory {

    companion object {
        @Volatile
        private var activeClient: OkHttpClient? = null

        /**
         * Called by SslPinningModule.setPins() after Remote Config delivers
         * the real pin set. Replaces the blocking client with the live one.
         */
        fun updateClient(client: OkHttpClient) {
            activeClient = client
        }

        /**
         * A client that refuses all TLS connections.
         * Used as the initial client before pins arrive from Remote Config,
         * so no unverified requests can escape during the startup window.
         */
        private fun buildBlockingClient(): OkHttpClient {
            // Pin an impossible value — every TLS connection will be rejected
            // until the real pins arrive via setPins() from Remote Config.
            val blocker = CertificatePinner.Builder()
                .add("*", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
                .build()
            return OkHttpClient.Builder()
                .certificatePinner(blocker)
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .writeTimeout(20, TimeUnit.SECONDS)
                .build()
        }
    }

    override fun createNewNetworkModuleClient(): OkHttpClient {
        // If pins have arrived from RC, use the real pinned client.
        // Otherwise use the blocker so nothing leaks before pins are set.
        return activeClient ?: buildBlockingClient()
    }
}