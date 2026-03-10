package fi.lcyt.tv

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val PREFS_NAME = "lcyt_tv_prefs"
private const val KEY_BACKEND_URL = "backend_url"
private const val KEY_VIEWER_KEY = "viewer_key"
const val DEFAULT_BACKEND_URL = "https://api.lcyt.fi"

private const val MAX_CAPTIONS = 50

enum class ConnectionStatus { IDLE, CONNECTING, CONNECTED, RECONNECTING, ERROR }

data class ViewerState(
    val backendUrl: String = DEFAULT_BACKEND_URL,
    val viewerKey: String = "",
    val captions: List<CaptionPayload> = emptyList(),
    val status: ConnectionStatus = ConnectionStatus.IDLE,
    val statusMessage: String = "",
    /** True when the viewer key hasn't been set yet — show settings screen. */
    val needsSetup: Boolean = true,
)

class CaptionViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = app.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(loadInitialState())
    val state: StateFlow<ViewerState> = _state.asStateFlow()

    private var sseJob: Job? = null

    init {
        // Auto-connect if a viewer key was already saved
        if (!_state.value.needsSetup) {
            connect(_state.value.backendUrl, _state.value.viewerKey)
        }
    }

    /** Called from [SettingsScreen] when user taps Connect. */
    fun saveAndConnect(backendUrl: String, viewerKey: String) {
        val url = backendUrl.trim().ifBlank { DEFAULT_BACKEND_URL }
        val key = viewerKey.trim()

        prefs.edit()
            .putString(KEY_BACKEND_URL, url)
            .putString(KEY_VIEWER_KEY, key)
            .apply()

        connect(url, key)
    }

    /** Disconnect and return to settings. */
    fun openSettings() {
        sseJob?.cancel()
        sseJob = null
        _state.value = _state.value.copy(
            status = ConnectionStatus.IDLE,
            statusMessage = "",
            needsSetup = true,
        )
    }

    private fun connect(backendUrl: String, viewerKey: String) {
        sseJob?.cancel()
        _state.value = _state.value.copy(
            backendUrl = backendUrl,
            viewerKey = viewerKey,
            status = ConnectionStatus.CONNECTING,
            statusMessage = "",
            needsSetup = false,
        )

        sseJob = viewModelScope.launch {
            sseFlow(backendUrl, viewerKey).collect { event ->
                when (event) {
                    is SseEvent.Connected -> _state.value = _state.value.copy(
                        status = ConnectionStatus.CONNECTED,
                        statusMessage = "",
                    )

                    is SseEvent.Caption -> {
                        val updated = (_state.value.captions + event.data).takeLast(MAX_CAPTIONS)
                        _state.value = _state.value.copy(captions = updated)
                    }

                    is SseEvent.Error -> {
                        val status = if (event.fatal) ConnectionStatus.ERROR
                        else ConnectionStatus.RECONNECTING
                        _state.value = _state.value.copy(
                            status = status,
                            statusMessage = event.message,
                        )
                        if (event.fatal) {
                            sseJob?.cancel()
                            sseJob = null
                        }
                    }

                    is SseEvent.SessionClosed -> _state.value = _state.value.copy(
                        status = ConnectionStatus.RECONNECTING,
                        statusMessage = "Session closed — reconnecting…",
                    )
                }
            }
        }
    }

    private fun loadInitialState(): ViewerState {
        val url = prefs.getString(KEY_BACKEND_URL, DEFAULT_BACKEND_URL) ?: DEFAULT_BACKEND_URL
        val key = prefs.getString(KEY_VIEWER_KEY, "") ?: ""
        return ViewerState(
            backendUrl = url,
            viewerKey = key,
            needsSetup = key.isBlank(),
        )
    }
}
