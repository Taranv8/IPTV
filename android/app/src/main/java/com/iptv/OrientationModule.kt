// OrientationModule.kt
package com.iptv

import android.content.pm.ActivityInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class OrientationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "OrientationModule"

    @ReactMethod
    fun lockToLandscape() {
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            activity.requestedOrientation =
                ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
    }

    @ReactMethod
    fun lockToPortrait() {
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            activity.requestedOrientation =
                ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }
}