# Keep OkHttp
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }

# Keep Gson model classes
-keep class fi.lcyt.tv.CaptionPayload { *; }

# Keep Kotlin coroutines
-keepnames class kotlinx.coroutines.** { *; }
