package com.iptv

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost

class MainApplication : Application(), ReactApplication {

  private val rnHost: ReactNativeHost =
    object : DefaultReactNativeHost(this) {

      override fun getPackages() =
        PackageList(this).packages.apply {
          // add(MyReactNativePackage())
        }

      override fun getJSBundleFile(): String? {
        val otaBundle = java.io.File("${filesDir.absolutePath}/ota/index.android.bundle")
        return if (otaBundle.exists()) otaBundle.absolutePath else null
      }

      override fun getBundleAssetName(): String = "index.android.bundle"
    }

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      reactNativeHost = rnHost
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}