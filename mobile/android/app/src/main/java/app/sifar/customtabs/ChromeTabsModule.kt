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
        .setStartAnimations(reactContext, android.R.anim.slide_in_left, android.R.anim.slide_out_right)
        .setExitAnimations(reactContext, android.R.anim.slide_in_left, android.R.anim.slide_out_right)

      // Set up Partial Custom Tabs (bottom sheet mode) when supported
      if (heightPx > 0) {
        try {
          // Force partial height behavior - key for embedded CCT
          val displayMetrics = reactContext.resources.displayMetrics
          val actualHeightPx = if (heightPx > displayMetrics.heightPixels) {
            (displayMetrics.heightPixels * 0.6).toInt() // Max 60% of screen
          } else {
            heightPx
          }
          
          builder.setInitialActivityHeightPx(actualHeightPx)
          Log.d("ChromeTabsModule", "Set initial height: $actualHeightPx (requested: $heightPx)")
          
          // Try to set additional properties using reflection (graceful degradation)
          try {
            val builderClass = builder::class.java
            
            // Try to set resizable behavior - this is CRITICAL for partial CCT
            try {
              val method = builderClass.getMethod("setActivityResizeBehavior", Int::class.java)
              method.invoke(builder, 2) // ACTIVITY_HEIGHT_ADJUSTABLE
              Log.d("ChromeTabsModule", "Set resizable behavior: ADJUSTABLE")
            } catch (e: NoSuchMethodException) {
              // Try alternative constant values
              try {
                val method = builderClass.getMethod("setActivityResizeBehavior", Int::class.java) 
                method.invoke(builder, 1) // Try different constant
                Log.d("ChromeTabsModule", "Set resizable behavior: fallback")
              } catch (e2: Exception) {
                Log.d("ChromeTabsModule", "setActivityResizeBehavior not available")
              }
            }
            
            // Try to set close button position  
            try {
              val method = builderClass.getMethod("setCloseButtonPosition", Int::class.java)
              method.invoke(builder, 1) // CLOSE_BUTTON_POSITION_END
              Log.d("ChromeTabsModule", "Set close button position")
            } catch (e: NoSuchMethodException) {
              Log.d("ChromeTabsModule", "setCloseButtonPosition not available")
            }
            
            // Try to set breakpoint behavior for better partial support
            try {
              val method = builderClass.getMethod("setActivityBreakpoint", Int::class.java)
              method.invoke(builder, actualHeightPx)
              Log.d("ChromeTabsModule", "Set activity breakpoint")
            } catch (e: Exception) {
              Log.d("ChromeTabsModule", "setActivityBreakpoint not available")
            }
            
          } catch (e: Exception) { 
            Log.w("ChromeTabsModule", "Failed to set advanced CCT properties: ${e.message}")
          }
        } catch (e: Throwable) { 
          Log.w("ChromeTabsModule", "Partial CCT setup failed: ${e.message}")
          Log.w("ChromeTabsModule", "Will launch standard CCT instead")
          // Don't throw - allow standard CCT to launch
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
