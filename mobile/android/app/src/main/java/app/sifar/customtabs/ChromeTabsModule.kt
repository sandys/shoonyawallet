package app.sifar.customtabs

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ChromeTabsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ChromeTabs"

  @ReactMethod
  fun open(url: String, heightPx: Int) {
    val builder = CustomTabsIntent.Builder()
      .setShowTitle(false)
      .setUrlBarHidingEnabled(true)
      .setShareState(CustomTabsIntent.SHARE_STATE_OFF)

    // Set initial height for Partial Custom Tabs when supported
    if (heightPx > 0) {
      try {
        builder.setInitialActivityHeightPx(heightPx)
      } catch (_: Throwable) { /* older androidx.browser */ }
    }

    val customTabsIntent = builder.build()
    customTabsIntent.launchUrl(reactContext, Uri.parse(url))
  }
}
