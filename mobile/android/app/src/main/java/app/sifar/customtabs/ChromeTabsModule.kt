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
          // This is the key method for partial CCT - it should be available in androidx.browser 1.8+
          builder.setInitialActivityHeightPx(heightPx)
          Log.d("ChromeTabsModule", "Set initial height: $heightPx")
          
          // Try to set additional properties using reflection (graceful degradation)
          try {
            // These methods might not exist in all versions, so use reflection
            val builderClass = builder::class.java
            
            // Try to set resizable behavior
            try {
              val method = builderClass.getMethod("setActivityResizeBehavior", Int::class.java)
              method.invoke(builder, 2) // ACTIVITY_HEIGHT_ADJUSTABLE
              Log.d("ChromeTabsModule", "Set resizable behavior")
            } catch (e: NoSuchMethodException) {
              Log.d("ChromeTabsModule", "setActivityResizeBehavior not available")
            }
            
            // Try to set close button position  
            try {
              val method = builderClass.getMethod("setCloseButtonPosition", Int::class.java)
              method.invoke(builder, 1) // CLOSE_BUTTON_POSITION_END
              Log.d("ChromeTabsModule", "Set close button position")
            } catch (e: NoSuchMethodException) {
              Log.d("ChromeTabsModule", "setCloseButtonPosition not available")
            }
            
          } catch (e: Exception) { 
            Log.w("ChromeTabsModule", "Failed to set advanced CCT properties: ${e.message}")
          }
        } catch (e: Throwable) { 
          Log.w("ChromeTabsModule", "Partial CCT not supported: ${e.message}")
          throw e
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
