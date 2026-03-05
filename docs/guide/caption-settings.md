---
title: Caption Settings (CC)
order: 4
---

# Caption Settings (CC)

Click **CC** in the top status bar to open the Closed Captions modal. It has up to four tabs, with the **Details** tab visible only in advanced mode.

---

## Service tab {#service}

The **Service** tab controls which speech-to-text engine is used and how it is configured.

### STT engine

| Option | Description |
|--------|-------------|
| **Web Speech API** | Browser built-in (Chrome / Edge). No account required. Enable **prefer local** to use on-device recognition (no audio sent to server). |
| **Google Cloud STT** | Higher accuracy, more language models. Requires a service account JSON key. |

### Microphone

Select which microphone to use if your device has more than one. Click **Refresh** to update the list.

### Recognition language

Choose the spoken language for the speech recogniser. Type to filter the list.

### STT model (Google Cloud only)

| Model | Best for |
|-------|---------|
| `latest_long` | Long-form speech; best for broadcast |
| `latest_short` | Short commands; lower latency |
| `telephony` | Phone-quality audio |

Additional Cloud STT options: **Auto-punctuation**, **Profanity filter**, **Confidence threshold**, **Max caption length**, and **Google Service Account** key upload.

### Utterance end button _(advanced mode only)_

Shows a 🗣 icon on the audio meter during active speech recognition. Click it to force-end the current utterance immediately (commits the partial transcript as a final caption).

### Utterance end timer _(advanced mode only)_

Automatically force-ends the utterance after N seconds (0 = disabled). Useful for segmenting long speeches into shorter captions.

---

## Receivers tab {#receivers}

The **Receivers** tab manages additional caption delivery destinations beyond your primary YouTube stream.

Click **+ Add target** to add a new entry. Each entry can be:

| Type | Description |
|------|-------------|
| **YouTube** | An extra YouTube stream key — captions are sent to that stream as well |
| **Generic** | A custom HTTP POST endpoint with optional JSON headers |

Each target can also have **Disable batch sending** enabled, which forces captions to be sent individually to that target regardless of the global batch setting.

> Changes take effect after reconnecting to the backend.

---

## Details tab _(advanced mode only)_ {#details}

> This tab is only visible when **Show advanced options** is enabled in Settings → Basic.

### Batching

| Setting | Description |
|---------|-------------|
| **Batch window** | `0` = send each caption immediately. `1–20 s` = collect captions over the window, then send as a single batch. |

### Transcription offset

Shifts the caption timestamp relative to when the transcription arrives. Use a negative value (e.g. `−5 s`) to compensate for transcription processing delay, so captions line up with the moment the speaker started talking in the YouTube stream.

Double-click the slider to reset to 0.

### Client-side VAD

**Voice Activity Detection (VAD)** monitors microphone energy and forces the recogniser to finalise when silence is detected. Helps segment long unbroken speech on mobile Chrome.

| Setting | Description |
|---------|-------------|
| **Enable VAD** | Turn on silence detection (WebKit engine only) |
| **Silence duration** | How long (ms) energy must stay below threshold before the recogniser is stopped |
| **Energy threshold** | RMS amplitude below which audio is considered silent (lower = more sensitive) |

---

## Translation tab {#translation}

The **Translation** tab configures real-time caption translation.

Click **+ Add translation** to add a target language. Each entry specifies:

| Field | Description |
|-------|-------------|
| **Enabled** | Toggle this translation on/off |
| **Language** | Target language (e.g. `en-US`) |
| **Target** | `captions` (YouTube stream), `file` (local), or `backend-file` |
| **Format** | `YouTube` or `WebVTT` (for file targets) |

### Translation vendors

| Vendor | Notes |
|--------|-------|
| **MyMemory** | Free, no API key needed |
| **Google Cloud Translation** | High quality; requires an API key |
| **DeepL** | Premium quality; requires an API key |
| **LibreTranslate** | Self-hosted; provide server URL and optional key |

### Show original

Enable **Show original** to include the original text alongside the translation in the YouTube caption stream (separated by a line break).

