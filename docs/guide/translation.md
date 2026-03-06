---
title: Translation
order: 5
---

# Translation

LCYT can translate your captions in real time and deliver the translation alongside the original text.

Click **CC** in the top status bar, then select the **Translation** tab.

---

## Translation vendor

| Vendor | Notes |
|--------|-------|
| **MyMemory** | Free, no API key required |
| **Google Cloud Translation** | High quality, wide language support; requires a Google Cloud API key |
| **LibreTranslate** | Self-hosted open-source option; provide your server URL and optional API key |
| **DeepL** | Premium translation quality; requires a DeepL API key |

---

## Adding a translation target

Click **+ Add translation** to add a new row. Each row defines one translation output:

| Field | Options | Description |
|-------|---------|-------------|
| **Enabled** | ☑ | Toggle this translation on/off without deleting it |
| **Language** | Any supported language | Target language for translation |
| **Target** | `captions`, `file`, `backend-file` | Where the translated text is delivered |
| **Format** | `youtube`, `vtt` | Caption format (for file targets only) |

### Target options

| Target | Behaviour |
|--------|-----------|
| **captions** | Translation is appended below the original caption on the YouTube stream (separated by `<br>`) |
| **file** | Translation is saved as a local file in the chosen format |
| **backend-file** | Translation is saved as a file on the relay backend server |

> **Note:** Only one `captions` target is allowed at a time (YouTube accepts one caption block per request).

---

## Show original

Enable **Show original** to keep the original caption text in the stream alongside the translation. When disabled, only the translation is shown.

---

## API key setup

### Google Cloud

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com).
2. Enable the **Cloud Translation API**.
3. Create an **API key** and paste it into the Google Cloud API Key field.

### LibreTranslate

1. Deploy a LibreTranslate instance (or use a public one).
2. Enter the server URL (e.g. `https://translate.example.com`).
3. Optionally enter an API key if your server requires one.

