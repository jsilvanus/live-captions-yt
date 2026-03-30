---
title: Application Flow
order: 10
---

# Application Flow

This page shows how all parts of the LCYT web app work together — from logging in to captions appearing on YouTube.

---

## Full system flow

```mermaid
flowchart TB
    subgraph Auth["Login & Session"]
        direction TB
        L1["Open /login\nChoose backend preset\n(Normal / Minimal / Custom)"]
        L2["Probe GET /health\nDiscover features"]
        L3{"login feature?"}
        L4["Email + Password\n→ POST /auth/login\n→ User JWT (30 d)"]
        L5["API Key entry only\n(minimal mode)"]
        L6["POST /live\n{ apiKey, targets[] }\n→ Session JWT"]
    end

    subgraph Input["Caption Input"]
        direction TB
        I1["Manual typing\nin Input Bar"]
        I2["Browser microphone\nWeb Speech API"]
        I3["Script file\n(.txt / .lcyt)\nstep line by line"]
        I4["Server-side STT\nGoogle / Whisper / OpenAI\naudio from HLS or RTMP"]
    end

    subgraph Backend["LCYT Backend"]
        direction TB
        B1["POST /captions\n{ text, timestamp }"]
        B2["Metacode processor\nstrips graphics: cue: tags"]
        B3["_sendQueue\nserialised delivery\nmonotonic sequence #"]
        B4["CueEngine\nphrase / fuzzy / semantic / AI\nevent cue matching"]
        B5["DSK caption processor\ngraphics metacodes → SSE"]
        B6["Session emitter\nroutes results to SSE"]
    end

    subgraph Targets["Delivery Targets"]
        direction TB
        T1["YouTube Live\nHTTP POST\n/caption_ingestion/v1"]
        T2["Viewer SSE\nGET /viewer/:key\npublic — no auth"]
        T3["Generic HTTP\nPOST to custom URL\n{ source, sequence, captions }"]
    end

    subgraph Results["Delivery Results"]
        direction TB
        R1["GET /events SSE stream\ncaption_result / caption_error\nmic_state / cue_fired"]
        R2["Sent log in UI\ngreen = delivered\nred = error"]
    end

    L1 --> L2 --> L3
    L3 -- Yes --> L4 --> L6
    L3 -- No  --> L5 --> L6

    I1 & I2 & I3 & I4 --> B1
    L6 -->|Bearer token| B1

    B1 --> B2
    B2 --> B3
    B2 --> B5
    B2 --> B4
    B3 --> T1 & T2 & T3
    T1 & T2 & T3 --> B6
    B6 --> R1 --> R2
```

---

## Caption target types

```mermaid
flowchart LR
    CAP["Caption text\n+ sequence #"]

    CAP --> YT
    CAP --> VIEWER
    CAP --> GENERIC

    subgraph YT["YouTube target"]
        YTA["YoutubeLiveCaptionSender\nHTTP POST to ingestion URL\nwith stream key"]
        YTB["YouTube closes-caption\ntrack on the live stream"]
        YTA --> YTB
    end

    subgraph VIEWER["Viewer target"]
        VA["broadcastToViewers(key, payload)"]
        VB["GET /viewer/:key\nSSE stream — CORS *\npublic — no auth required"]
        VC["lcyt-tv Android app\nor embedded viewer page\n/view/:key"]
        VA --> VB --> VC
    end

    subgraph GENERIC["Generic target"]
        GA["HTTP POST\nto configured URL\nwith custom headers"]
        GB["Any webhook receiver\nexternal system"]
        GA --> GB
    end
```

---

## RTMP & streaming flow

```mermaid
flowchart TB
    subgraph Sources["Sources"]
        CAM["Cameras\n(AMX / VISCA-IP / Webcam)"]
        SCR["Screen / Desktop"]
        AUD["Microphone / Audio"]
    end

    subgraph AV["AV Layer"]
        MIX["Video Mixer\n(Roland / ATEM / OBS / AMX / LCYT)"]
    end

    subgraph Ingest["RTMP Ingest"]
        ENC["RTMP Encoder\n(OBS / hardware)"]
        MTX["MediaMTX\nRTMP server"]
    end

    subgraph lcytBackend["LCYT Backend — lcyt-rtmp plugin"]
        HLS["HLS Manager\nvideo + audio\n/stream-hls/:key"]
        RADIO["Radio Manager\naudio-only HLS\n/radio/:key"]
        PREV["Preview Manager\nJPEG thumbnail\n/preview/:key"]
        STT["STT Manager\nGoogle / Whisper / OpenAI\n→ auto captions"]
        RELAY["RTMP Relay\nup to 4 destinations"]
        SUBS["HLS Subs Manager\nWebVTT subtitle\nsidecar segments"]
        DSK["DSK Renderer\nPlaywright + Chromium\ngraphics overlay"]
    end

    subgraph Outputs["Outputs"]
        YT_STREAM["YouTube Live\nvideo stream\n(from encoder)"]
        YT_CAP["YouTube Captions\nHTTP POST API"]
        HLS_OUT["HLS player embed\nor any HLS client"]
        RADIO_OUT["Audio-only HLS\nradio player"]
        PREV_OUT["Preview thumbnail\nin web UI"]
        VIEWER_OUT["Caption viewer\n/view/:key"]
    end

    CAM & SCR & AUD --> MIX
    MIX -->|PGM out| ENC
    ENC -->|RTMP| MTX
    ENC -->|RTMP| YT_STREAM

    MTX --> HLS & RADIO & PREV & STT & RELAY
    HLS --> HLS_OUT
    RADIO --> RADIO_OUT
    PREV --> PREV_OUT
    STT -->|transcript| YT_CAP & VIEWER_OUT
    STT --> SUBS --> HLS_OUT

    DSK -->|keyed RTMP| MIX
    RELAY -->|RTMP| YT_STREAM
```

---

## Multi-target session example

A typical broadcast session with captions on YouTube, a public viewer page, and an embedded HLS stream:

```mermaid
sequenceDiagram
    participant OP as Operator (lcyt-web)
    participant BE as LCYT Backend
    participant YT as YouTube API
    participant VW as Viewer SSE

    OP->>BE: POST /live { apiKey, targets: [youtube, viewer] }
    BE-->>OP: 200 { token, sessionId }

    OP->>BE: POST /captions { text: "Hello everyone" }
    BE-->>OP: 202 { ok, requestId }

    BE->>YT: POST /caption_ingestion/v1?streamKey=…
    YT-->>BE: 204 OK

    BE->>VW: broadcast { text, sequence, timestamp }

    BE-->>OP: SSE caption_result { requestId, ok: true }
    OP-->>OP: Sent log turns green ✓
```

---

## DSK graphics flow

```mermaid
flowchart LR
    subgraph OP["Operator"]
        CAPTION["Caption with metacode\n<!-- graphics:logo,banner -->"]
    end

    subgraph BE["Backend — lcyt-dsk plugin"]
        PROC["DSK Caption Processor\nextracts graphics: tags"]
        SSE["DSK SSE stream\nGET /dsk/:key/events"]
        REND["Playwright Renderer\nheadless Chromium"]
        FFMPEG["ffmpeg\nframes → RTMP"]
    end

    subgraph Outputs["Outputs"]
        DSK_PAGE["DSK page /dsk/:key\ntransparent green-screen overlay\ndisplayed in browser or OBS"]
        RTMP_OUT["RTMP keyed output\n→ nginx-rtmp → mixer"]
    end

    CAPTION --> PROC
    PROC --> SSE --> DSK_PAGE
    PROC --> REND --> FFMPEG --> RTMP_OUT
```
