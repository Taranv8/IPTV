package com.iptv.sslpinning

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import com.iptv.BuildConfig
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody
import java.util.concurrent.TimeUnit

class PinnedOkHttpClientFactory : OkHttpClientFactory {

    companion object {

        @Volatile
        private var activeClient: OkHttpClient? = null

        fun updateClient(pinnedClient: OkHttpClient) {
            activeClient = OkHttpClientProvider.createClientBuilder()
                .certificatePinner(pinnedClient.certificatePinner)
                .connectTimeout(
                    pinnedClient.connectTimeoutMillis.toLong(),
                    TimeUnit.MILLISECONDS
                )
                .readTimeout(
                    pinnedClient.readTimeoutMillis.toLong(),
                    TimeUnit.MILLISECONDS
                )
                .writeTimeout(
                    pinnedClient.writeTimeoutMillis.toLong(),
                    TimeUnit.MILLISECONDS
                )
                .build()
        }

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
            // Allow every request in Debug builds (Metro, localhost, LAN IPs, etc.)
            if (BuildConfig.DEBUG) {
                return true
            }

            val host = url.host.lowercase()

            return FIREBASE_ALLOWED_SUFFIXES.any { suffix ->
                host == suffix || host.endsWith(".$suffix")
            }
        }

        private fun buildBlockingClient(): OkHttpClient {
            return OkHttpClientProvider.createClientBuilder()
                .addInterceptor { chain ->
                    val request = chain.request()

                    if (isAllowedPrePinHost(request.url)) {
                        chain.proceed(request)
                    } else {
                        Response.Builder()
                            .request(request)
                            .protocol(Protocol.HTTP_1_1)
                            .code(503)
                            .message("SSL pinning not yet initialised")
                            .body(ResponseBody.create(null, ByteArray(0)))
                            .build()
                    }
                }
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .writeTimeout(20, TimeUnit.SECONDS)
                .build()
        }
    }

    override fun createNewNetworkModuleClient(): OkHttpClient {
        // In Debug builds, use React Native's default client.
        if (BuildConfig.DEBUG) {
            return OkHttpClientProvider.createClientBuilder().build()
        }

        // In Release builds, use the pinned client if available.
        return activeClient ?: buildBlockingClient()
    }
}