package com.iptv

import android.app.Application
import java.io.File

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost

import com.facebook.react.modules.network.OkHttpClientProvider

import com.iptv.RootDetectionPackage
import com.iptv.sslpinning.PinnedOkHttpClientFactory

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {

            override fun getUseDeveloperSupport() = BuildConfig.DEBUG

            override fun getPackages() =
                PackageList(this).packages.apply {
                    add(OrientationPackage())
                    add(RootDetectionPackage())
                    add(SslPinningPackage())
                }

            override fun getJSMainModuleName() = "index"

            /**
             * Debug -> Metro
             * Release -> OTA bundle if available
             */
            override fun getJSBundleFile(): String? {
                if (BuildConfig.DEBUG) {
                    return null
                }

                val otaBundle =
                    File("${filesDir.absolutePath}/ota/index.android.bundle")

                return if (otaBundle.exists()) {
                    otaBundle.absolutePath
                } else {
                    null
                }
            }

            override fun getBundleAssetName() = "index.android.bundle"
        }

    override val reactHost: ReactHost by lazy {
        getDefaultReactHost(
            context = applicationContext,
            reactNativeHost = reactNativeHost
        )
    }

    override fun onCreate() {
        super.onCreate()

        // Enable SSL pinning only in Release builds.
        if (!BuildConfig.DEBUG) {
            OkHttpClientProvider.setOkHttpClientFactory(
                PinnedOkHttpClientFactory()
            )
        }

        loadReactNative(this)
    }
}