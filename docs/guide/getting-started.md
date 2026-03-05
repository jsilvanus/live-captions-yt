---
title: Getting Started
order: 2
---

# Getting Started

This guide walks you through the full setup from a brand-new account to your first live caption.

---

## Prerequisites

Before you start you need:

1. A **YouTube Live** stream with a 30-second delay enabled
2. An **LCYT API key** (free — see below)
3. A modern browser (Chrome, Edge, or any Chromium-based browser recommended)

---

## Step 1 — Enable closed captions in YouTube Studio

1. Go to [YouTube Studio](https://studio.youtube.com) → **Go Live**.
2. In your stream settings, open the **Advanced** tab.
3. Enable **Closed captions** and choose the **HTTP POST** method.
4. Set the **stream delay to at least 30 seconds** (required by the caption API).
5. Copy your **Stream Key** — you will need it shortly.

---

## Step 2 — Get a free API key

Visit [lcyt.fi/app](https://lcyt.fi/app) and fill in the free-key form with your name and email address.
Your key is emailed to you instantly and works for up to **200 captions per day** for **30 days**.

> **Tip:** Paid keys with higher limits and longer validity are available — contact the LCYT team.

---

## Step 3 — Open the web app

Navigate to **[app.lcyt.fi](https://app.lcyt.fi)**.  
On the first visit the **Privacy** modal opens automatically. Read the policy and click **Accept** to continue.

![Privacy acceptance modal](/screenshots/privacy-first-visit-light.png)

---

## Step 4 — Enter your credentials

Click **General** in the top status bar to open the General Settings modal.

![General settings modal](/screenshots/modal-general-light.png)

Fill in:

| Field | Value |
|-------|-------|
| **API Key** | The key you received by email |
| **Stream Key** | Copied from YouTube Studio |
| **Backend URL** | `https://api.lcyt.fi` (default — leave as-is) |

Optionally enable **Auto-connect** to reconnect automatically on every visit.

Click **Connect**. The status bar turns green when you are live.

---

## Step 5 — Send your first caption

Type a test caption in the input bar at the bottom of the page and press **Enter** (or click **Send**).

The caption appears in the **Sent** log on the right and is delivered to your YouTube stream within a few seconds.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "Connection failed" | Wrong API key or backend URL | Double-check both fields in General settings |
| Captions not appearing on stream | Stream delay or captions not enabled | Enable HTTP POST captions in YouTube Studio |
| Network banner (⚠) | Backend unreachable | Check your internet connection; the app retries every 30 s |
| Clock offset warning | Server and browser clocks differ | Click **Sync clock** in the Actions panel |
