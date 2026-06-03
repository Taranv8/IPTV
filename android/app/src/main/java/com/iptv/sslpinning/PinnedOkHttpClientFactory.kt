package com.iptv.sslpinning

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import okhttp3.HttpUrl
import javax.net.ssl.SSLPeerUnverifiedException
import java.util.concurrent.TimeUnit

class PinnedOkHttpClientFactory : OkHttpClientFactory {

    companion object {

        @Volatile
        private var activeClient: OkHttpClient? = null

      fun updateClient(pinnedClient: OkHttpClient) {
    // Re-wrap the pinned client on RN's base builder so CookieJarContainer
    // is preserved. SslPinningModule builds with plain OkHttpClient.Builder()
    // intentionally — the RN wrapping happens here and only here.
    activeClient = OkHttpClientProvider.createClientBuilder()
        .sslSocketFactory(
            pinnedClient.sslSocketFactory,
            pinnedClient.x509TrustManager!!
        )
        .certificatePinner(pinnedClient.certificatePinner)
        .connectTimeout(pinnedClient.connectTimeoutMillis.toLong(), TimeUnit.MILLISECONDS)
        .readTimeout(pinnedClient.readTimeoutMillis.toLong(), TimeUnit.MILLISECONDS)
        .writeTimeout(pinnedClient.writeTimeoutMillis.toLong(), TimeUnit.MILLISECONDS)
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
            val host = url.host.lowercase()
            return FIREBASE_ALLOWED_SUFFIXES.any { suffix ->
                host == suffix || host.endsWith(".$suffix")
            }
        }

        private fun buildBlockingClient(): OkHttpClient {
            // ✅ KEY FIX: start from RN's own builder so CookieJarContainer
            // and all other RN internals are pre-installed correctly.
            return OkHttpClientProvider.createClientBuilder()
                .addInterceptor { chain ->
                    val request = chain.request()
                    if (isAllowedPrePinHost(request.url)) {
                        chain.proceed(request)
                    } else {
                        // Return 503 instead of throwing so the RN bridge
                        // doesn't crash on its own internal requests.
                        okhttp3.Response.Builder()
                            .request(request)
                            .protocol(okhttp3.Protocol.HTTP_1_1)
                            .code(503)
                            .message("SSL pinning not yet initialised")
                            .body(
                                okhttp3.ResponseBody.create(
                                    null,
                                    ByteArray(0)
                                )
                            )
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
        return activeClient ?: buildBlockingClient()
    }
}