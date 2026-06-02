package com.iptv.sslpinning

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * SslPinningPackage
 *
 * Register this in MainApplication.kt / MainApplication.java:
 *
 *   override fun getPackages(): List<ReactPackage> =
 *       PackageList(this).packages.apply {
 *           add(SslPinningPackage())     // <-- add this line
 *       }
 */
class SslPinningPackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =
        listOf(SslPinningModule(ctx))

    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
