package app.sifar.customtabs

import android.net.Uri
import android.util.Log
import androidx.browser.customtabs.CustomTabsIntent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ChromeTabsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ChromeTabs"

  @ReactMethod
  fun open(url: String, heightPx: Int) {
    try {
      Log.d("ChromeTabsModule", "Opening CCT: url=$url, heightPx=$heightPx")
      
      val builder = CustomTabsIntent.Builder()
        .setShowTitle(false)
        .setUrlBarHidingEnabled(true)
        .setShareState(CustomTabsIntent.SHARE_STATE_OFF)

      // Set up Partial Custom Tabs (bottom sheet mode) when supported
      if (heightPx > 0) {
        try {
          builder.setInitialActivityHeightPx(heightPx)
          Log.d("ChromeTabsModule", "Set initial height: $heightPx")
          
          // Enable resizable behavior for partial CCT  
          try {
            builder.setActivityResizeBehavior(CustomTabsIntent.ACTIVITY_HEIGHT_ADJUSTABLE)
            Log.d("ChromeTabsModule", "Set resizable behavior")
          } catch (e: Exception) { 
            Log.w("ChromeTabsModule", "Failed to set resize behavior: ${e.message}")
          }

          // Set close button position
          try {
            builder.setCloseButtonPosition(CustomTabsIntent.CLOSE_BUTTON_POSITION_END)
            Log.d("ChromeTabsModule", "Set close button position")
          } catch (e: Exception) { 
            Log.w("ChromeTabsModule", "Failed to set close button: ${e.message}")
          }
        } catch (e: Throwable) { 
          Log.w("ChromeTabsModule", "Partial CCT not supported: ${e.message}")
        }
      }

      val customTabsIntent = builder.build()
      val currentActivity = reactContext.currentActivity
      if (currentActivity != null) {
        customTabsIntent.launchUrl(currentActivity, Uri.parse(url))
        Log.d("ChromeTabsModule", "CCT launched successfully")
      } else {
        customTabsIntent.launchUrl(reactContext, Uri.parse(url))
        Log.d("ChromeTabsModule", "CCT launched with context")
      }
    } catch (e: Exception) {
      Log.e("ChromeTabsModule", "Failed to open CCT: ${e.message}", e)
      throw e
    }
  }
}
