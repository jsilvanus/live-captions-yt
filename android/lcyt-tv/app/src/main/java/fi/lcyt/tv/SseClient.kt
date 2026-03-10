package fi.lcyt.tv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

/** Events emitted by [sseFlow]. */
sealed class SseEvent {
    data object Connected : SseEvent()
    data class Caption(val data: CaptionPayload) : SseEvent()
    data class Error(val message: String, val fatal: Boolean = false) : SseEvent()
    data object SessionClosed : SseEvent()
}

/**
 * JSON payload received on the `caption` SSE event from `GET /viewer/:key`.
 *
 * Fields mirror the backend's `broadcastToViewers()` call in captions.js:
 *   { text, composedText?, sequence, timestamp, translations?, codes? }
 */
data class CaptionPayload(
    val text: String,
    val composedText: String?,
    val sequence: Int,
    val timestamp: String,
    val translations: Map<String, String> = emptyMap(),
)

/**
 * Connects to `GET {backendUrl}/viewer/{viewerKey}` and emits [SseEvent]s.
 *
 * The flow never completes on its own — it reconnects automatically with
 * exponential back-off (1 s → 2 s → 4 s … max 30 s) after any network error.
 * Cancel the coroutine scope to stop it.
 *
 * Heartbeat comments (`:heartbeat`) are silently ignored.
 */
fun sseFlow(backendUrl: String, viewerKey: String): Flow<SseEvent> = flow {
    val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS) // must be > heartbeat interval (25 s)
        .build()

    val url = "${backendUrl.trimEnd('/')}/viewer/${viewerKey.trim()}"
    var backoffMs = 1_000L

    while (true) {
        val request = Request.Builder()
            .url(url)
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .build()

        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val fatal = response.code in 400..499
                    emit(SseEvent.Error("HTTP ${response.code}", fatal = fatal))
                    if (fatal) return@flow
                    delay(backoffMs)
                    backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
                    return@use
                }

                // Reset back-off on successful connection
                backoffMs = 1_000L

                val body = response.body ?: run {
                    emit(SseEvent.Error("Empty response body"))
                    return@use
                }

                BufferedReader(InputStreamReader(body.byteStream())).use { reader ->
                    var eventType = ""
                    val dataLines = mutableListOf<String>()

                    reader.lineSequence().forEach { line ->
                        when {
                            // Heartbeat / comment — ignore
                            line.startsWith(":") -> {}

                            // Event type field
                            line.startsWith("event:") ->
                                eventType = line.removePrefix("event:").trim()

                            // Data field — accumulate for multi-line data
                            line.startsWith("data:") ->
                                dataLines.add(line.removePrefix("data:").trim())

                            // Empty line = end of event block — dispatch
                            line.isEmpty() -> {
                                val raw = dataLines.joinToString("\n")
                                dataLines.clear()

                                when (eventType) {
                                    "connected" -> emit(SseEvent.Connected)
                                    "caption" -> {
                                        val payload = parseCaptionPayload(raw)
                                        if (payload != null) emit(SseEvent.Caption(payload))
                                    }
                                    "session_closed" -> {
                                        emit(SseEvent.SessionClosed)
                                        return@use // stop reading; will reconnect
                                    }
                                }
                                eventType = ""
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            emit(SseEvent.Error(e.message ?: "Unknown error"))
        }

        delay(backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
        emit(SseEvent.Error("Reconnecting in ${backoffMs / 1000} s…"))
    }
}.flowOn(Dispatchers.IO)

private fun parseCaptionPayload(json: String): CaptionPayload? = try {
    val obj = com.google.gson.JsonParser.parseString(json).asJsonObject
    val translations = mutableMapOf<String, String>()
    obj.getAsJsonObject("translations")?.entrySet()?.forEach { (k, v) ->
        translations[k] = v.asString
    }
    CaptionPayload(
        text = obj.get("text")?.asString ?: return null,
        composedText = obj.get("composedText")?.asString,
        sequence = obj.get("sequence")?.asInt ?: 0,
        timestamp = obj.get("timestamp")?.asString ?: "",
        translations = translations,
    )
} catch (_: Exception) {
    null
}
