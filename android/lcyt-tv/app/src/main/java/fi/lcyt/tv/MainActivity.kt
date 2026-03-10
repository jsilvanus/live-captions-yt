package fi.lcyt.tv

import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

class MainActivity : ComponentActivity() {

    private val viewModel: CaptionViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Handle deep-link: lcyt-tv://viewer?server=...&key=...
        intent?.data?.let { uri -> handleDeepLink(uri) }

        setContent {
            val state by viewModel.state.collectAsStateWithLifecycle()
            LcytTvApp(
                state = state,
                onConnect = viewModel::saveAndConnect,
                onOpenSettings = viewModel::openSettings,
            )
        }
    }

    // D-pad Menu button or back-long-press → open settings
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            viewModel.openSettings()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun handleDeepLink(uri: Uri) {
        val server = uri.getQueryParameter("server") ?: DEFAULT_BACKEND_URL
        val key = uri.getQueryParameter("key") ?: return
        viewModel.saveAndConnect(server, key)
    }
}

// ---------------------------------------------------------------------------
// Root composable — switches between settings and viewer
// ---------------------------------------------------------------------------

@Composable
fun LcytTvApp(
    state: ViewerState,
    onConnect: (backendUrl: String, viewerKey: String) -> Unit,
    onOpenSettings: () -> Unit,
) {
    AnimatedContent(
        targetState = state.needsSetup,
        transitionSpec = { fadeIn() togetherWith fadeOut() },
        label = "screen_transition",
    ) { showSettings ->
        if (showSettings) {
            SettingsScreen(
                initialBackendUrl = state.backendUrl,
                initialViewerKey = state.viewerKey,
                onConnect = onConnect,
            )
        } else {
            ViewerScreen(
                state = state,
                onOpenSettings = onOpenSettings,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Viewer screen — full-screen caption display
// ---------------------------------------------------------------------------

@Composable
fun ViewerScreen(
    state: ViewerState,
    onOpenSettings: () -> Unit,
) {
    val listState = rememberLazyListState()

    // Auto-scroll to the latest caption
    LaunchedEffect(state.captions.size) {
        if (state.captions.isNotEmpty()) {
            listState.animateScrollToItem(state.captions.lastIndex)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        if (state.captions.isEmpty()) {
            // Idle / waiting state
            Column(
                modifier = Modifier.align(Alignment.Center),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = "Waiting for captions…",
                    color = Color(0xFF666666),
                    fontSize = 24.sp,
                )
                if (state.status != ConnectionStatus.CONNECTED) {
                    Text(
                        text = statusLabel(state.status, state.viewerKey),
                        color = statusColor(state.status),
                        fontSize = 16.sp,
                    )
                }
            }
        } else {
            // Caption list — latest at bottom
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 80.dp, vertical = 48.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(
                    items = state.captions,
                    key = { "${it.sequence}_${it.timestamp}" },
                ) { caption ->
                    CaptionRow(caption = caption, isLatest = caption == state.captions.last())
                }
            }
        }

        // Status bar — top-right corner
        StatusDot(
            status = state.status,
            message = state.statusMessage,
            viewerKey = state.viewerKey,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(24.dp),
        )
    }
}

@Composable
private fun CaptionRow(caption: CaptionPayload, isLatest: Boolean) {
    // Prefer composedText (original + translation) — mirrors viewerUtils.js default
    val display = caption.composedText ?: caption.text

    // Split on <br> to render original and translation on separate lines
    val lines = display.split("<br>", ignoreCase = true)

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        lines.forEachIndexed { index, line ->
            Text(
                text = line.trim(),
                color = if (isLatest) Color.White else Color(0xFF888888),
                fontSize = if (isLatest && index == 0) 34.sp else if (index == 0) 24.sp else 20.sp,
                fontWeight = if (isLatest && index == 0) FontWeight.Bold else FontWeight.Normal,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
                lineHeight = if (isLatest && index == 0) 40.sp else 28.sp,
            )
        }
    }
}

@Composable
private fun StatusDot(
    status: ConnectionStatus,
    message: String,
    viewerKey: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (message.isNotBlank()) {
            Text(
                text = message,
                color = Color(0xFF888888),
                fontSize = 13.sp,
            )
        } else if (status == ConnectionStatus.CONNECTED && viewerKey.isNotBlank()) {
            Text(
                text = "/$viewerKey",
                color = Color(0xFF555555),
                fontSize = 13.sp,
            )
        }

        Box(
            modifier = Modifier
                .size(10.dp)
                .background(
                    color = statusColor(status),
                    shape = androidx.compose.foundation.shape.CircleShape,
                ),
        )
    }
}

private fun statusLabel(status: ConnectionStatus, key: String): String = when (status) {
    ConnectionStatus.IDLE -> "Press Menu to configure"
    ConnectionStatus.CONNECTING -> "Connecting to /$key…"
    ConnectionStatus.CONNECTED -> "Connected"
    ConnectionStatus.RECONNECTING -> "Reconnecting…"
    ConnectionStatus.ERROR -> "Connection error"
}

private fun statusColor(status: ConnectionStatus): Color = when (status) {
    ConnectionStatus.CONNECTED -> Color(0xFF4CAF50)   // green
    ConnectionStatus.CONNECTING,
    ConnectionStatus.RECONNECTING -> Color(0xFFFFA726) // amber
    ConnectionStatus.ERROR -> Color(0xFFEF5350)        // red
    ConnectionStatus.IDLE -> Color(0xFF555555)          // gray
}
