package fi.lcyt.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val KEY_REGEX = Regex("^[a-zA-Z0-9_-]{3,}$")

/**
 * Full-screen settings UI shown on first launch or when the user presses Menu.
 *
 * The backend URL field is pre-filled with [DEFAULT_BACKEND_URL] and is
 * optional — most users only need to enter the viewer key.
 */
@Composable
fun SettingsScreen(
    initialBackendUrl: String,
    initialViewerKey: String,
    onConnect: (backendUrl: String, viewerKey: String) -> Unit,
) {
    var backendUrl by remember { mutableStateOf(initialBackendUrl.ifBlank { DEFAULT_BACKEND_URL }) }
    var viewerKey by remember { mutableStateOf(initialViewerKey) }
    var keyError by remember { mutableStateOf(false) }

    val keyFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        // Focus the viewer key field on launch (most users only need this)
        keyFocus.requestFocus()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0A0A0A)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.width(560.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Title
            Text(
                text = "LCYT Caption Viewer",
                color = Color.White,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
            )

            Text(
                text = "Enter the viewer key from the web UI (CC → Targets tab).",
                color = Color(0xFFAAAAAA),
                fontSize = 16.sp,
            )

            Spacer(Modifier.height(8.dp))

            // Viewer Key field — primary input
            OutlinedTextField(
                value = viewerKey,
                onValueChange = {
                    viewerKey = it
                    keyError = false
                },
                label = { Text("Viewer Key", color = Color(0xFFAAAAAA)) },
                placeholder = { Text("e.g. myevent", color = Color(0xFF555555)) },
                isError = keyError,
                supportingText = if (keyError) {
                    { Text("Min 3 chars — letters, numbers, - or _", color = MaterialTheme.colorScheme.error) }
                } else null,
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { tryConnect(viewerKey, backendUrl, onConnect) { keyError = true } }),
                colors = tvTextFieldColors(),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(keyFocus),
            )

            // Backend URL field — optional / advanced
            OutlinedTextField(
                value = backendUrl,
                onValueChange = { backendUrl = it },
                label = { Text("Backend URL (optional)", color = Color(0xFFAAAAAA)) },
                placeholder = { Text(DEFAULT_BACKEND_URL, color = Color(0xFF555555)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Next,
                ),
                colors = tvTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(4.dp))

            // Connect button
            Button(
                onClick = { tryConnect(viewerKey, backendUrl, onConnect) { keyError = true } },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF1A73E8),
                    contentColor = Color.White,
                ),
            ) {
                Text("Connect", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

private fun tryConnect(
    viewerKey: String,
    backendUrl: String,
    onConnect: (String, String) -> Unit,
    onError: () -> Unit,
) {
    if (!KEY_REGEX.matches(viewerKey.trim())) {
        onError()
        return
    }
    onConnect(backendUrl.trim().ifBlank { DEFAULT_BACKEND_URL }, viewerKey.trim())
}

@Composable
private fun tvTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Color(0xFF1A73E8),
    unfocusedBorderColor = Color(0xFF444444),
    focusedTextColor = Color.White,
    unfocusedTextColor = Color(0xFFCCCCCC),
    cursorColor = Color(0xFF1A73E8),
    focusedLabelColor = Color(0xFF1A73E8),
)
