---
title: Caption Settings
order: 4
---

# Caption Settings

Click **Caption** in the top status bar to open the Caption Settings modal. It contains three tabs: **Model**, **VAD**, and **Other**.

---

## Model tab {#model}

The **Model** tab controls which speech-to-text engine is used and how it is configured.

![Caption settings — Model tab](/screenshots/modal-caption-model-light.png)

### STT engine

| Option | Description |
|--------|-------------|
| **Browser** | Uses the Web Speech API built into Chrome/Edge — no extra setup, no cost, but quality varies by browser and OS |
| **Google Cloud STT** | Uses Google Cloud Speech-to-Text — requires a Google Cloud API key, but gives much higher accuracy and more language options |

### Caption language

Choose the spoken language for the speech recogniser. For **Browser STT**, the list is filtered to languages your browser reports as supported. For **Google Cloud STT**, all supported languages are available.

### STT model (Google Cloud only)

| Model | Best for |
|-------|---------|
| `latest_long` | Long-form speech; best for broadcast |
| `latest_short` | Short commands; lower latency |
| `telephony` | Phone-quality audio |
| `medical_*` | Medical terminology (English only) |

### Microphone device

Select which microphone to use if your device has more than one.

### Punctuation & profanity filter (Google Cloud only)

- **Auto-punctuation** — adds commas and periods automatically
- **Profanity filter** — masks offensive words with asterisks

---

## VAD tab {#vad}

**Voice Activity Detection (VAD)** decides when an utterance ends and the caption is committed.

![Caption settings — VAD tab](/screenshots/modal-caption-vad-light.png)

| Setting | Description |
|---------|-------------|
| **End-of-utterance timeout** | Silence duration (ms) before the current recognition result is committed as a caption |
| **Max utterance length** | Maximum caption length in characters before an automatic split |
| **Utterance end button** | Show an "end utterance" button on the mobile audio bar for manual control |

Shorter timeouts give snappier captions at the cost of more frequent splits. Longer timeouts can produce more natural phrasing.

---

## Other tab {#other}

The **Other** tab covers text display and timing options.

![Caption settings — Other tab](/screenshots/modal-caption-other-light.png)

| Setting | Description |
|---------|-------------|
| **Text size** | Font size in the caption preview area (px) |
| **Batch interval** | If > 0, captions are queued and sent every N seconds instead of immediately |
| **Transcription offset** | Shifts caption timestamps by ±N ms to compensate for encoding or delivery lag |
