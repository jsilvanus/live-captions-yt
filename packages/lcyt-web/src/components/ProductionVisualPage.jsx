import { MermaidChart } from './MermaidChart.jsx';

const VIDEO_SIGNAL_FLOW = `
flowchart TB
    subgraph Sources["Video & Audio Sources"]
        direction LR
        CAM1["Camera 1\\nAMX / VISCA-IP PTZ"]
        CAM2["Camera 2\\nAMX / VISCA-IP PTZ"]
        WCAM["Webcam / Mobile\\nbrowser capture"]
        SCRN["Screen Capture\\n/ Desktop"]
        MIC["Microphone\\n/ Audio Interface"]
    end

    subgraph AV["AV Hardware Layer"]
        direction LR
        MIX["Video Mixer\\nRoland / ATEM / OBS\\nAMX / LCYT / Monarch HDX"]
        PGM["Program Output\\n(PGM)"]
        DSK_IN["DSK Keyed Input\\n(overlay return)"]
    end

    subgraph Bridge["Bridge Agent (lcyt-bridge)"]
        direction TB
        BAGT["lcyt-bridge\\non-site agent"]
        TCP["TCP Pool\\nAMX NetLinx / Roland"]
    end

    subgraph Encoder["RTMP Encoder"]
        ENC["OBS Studio\\nor hardware encoder"]
    end

    subgraph Ingest["RTMP Ingest Server"]
        MTX["MediaMTX\\nRTMP / RTSP / HLS origin"]
    end

    subgraph lcytBackend["LCYT Backend (lcyt-backend + plugins)"]
        direction TB
        HLS_MGR["HLS Manager\\nvideo + audio segments"]
        RADIO_MGR["Radio Manager\\naudio-only HLS\\n(ffmpeg or MediaMTX)"]
        PREV_MGR["Preview Manager\\nJPEG thumbnails\\nevery 5 s"]
        STT_MGR["STT Manager\\nGoogle / Whisper / OpenAI\\nHLS segment → transcript"]
        SUBS_MGR["HLS Subs Manager\\nrolling WebVTT\\nsubtitle sidecar"]
        RELAY_MGR["RTMP Relay Manager\\nup to 4 destinations"]
        DSK_REND["DSK Renderer\\nPlaywright + Chromium\\ngraphics overlay"]
        CAP_Q["Caption Queue\\n_sendQueue\\nmonotonic sequence #"]
        CUE_E["Cue Engine\\nphrase / fuzzy / semantic / AI\\nauto-advance rundown"]
        AGENT["AI Agent\\nLLM event evaluation\\ncontext window"]
    end

    subgraph Operator["Caption Operator"]
        direction LR
        WEB["lcyt-web\\nBrowser UI"]
        CLI["lcyt-cli\\nTerminal"]
        MCP_S["MCP Server\\nAI assistant integration"]
    end

    subgraph Outputs["Delivery Outputs"]
        direction TB
        YT_VID["YouTube Live\\nvideo stream"]
        YT_CAP["YouTube Captions\\nHTTP POST ingestion API"]
        HLS_OUT["HLS Video + Audio\\n/stream-hls/:key\\npublic"]
        RADIO_OUT["Radio HLS\\n/radio/:key\\naudio-only — public"]
        PREV_OUT["Preview Thumbnail\\n/preview/:key\\nJPEG — public"]
        VIEWER_OUT["Caption Viewer SSE\\n/viewer/:key\\npublic — no auth"]
        RTMP_RELAY["RTMP Relay\\nup to 4 targets\\n(CDN, platform, etc.)"]
        DSK_RTMP["DSK Keyed RTMP\\nnginx-rtmp → mixer"]
    end

    CAM1 & CAM2 & WCAM & SCRN --> MIX
    MIC --> ENC
    MIX --> PGM
    DSK_IN --> MIX
    PGM --> ENC
    ENC -->|RTMP| MTX
    ENC -->|RTMP| YT_VID

    MTX --> HLS_MGR & RADIO_MGR & PREV_MGR & STT_MGR & RELAY_MGR

    HLS_MGR --> HLS_OUT
    SUBS_MGR --> HLS_OUT
    RADIO_MGR --> RADIO_OUT
    PREV_MGR --> PREV_OUT
    RELAY_MGR --> RTMP_RELAY

    STT_MGR -->|auto transcript| CAP_Q

    WEB & CLI & MCP_S -->|manual captions| CAP_Q

    CAP_Q --> CUE_E
    CAP_Q --> YT_CAP & VIEWER_OUT
    CAP_Q --> SUBS_MGR

    CUE_E --> AGENT

    DSK_REND -->|keyed RTMP frames| DSK_RTMP
    DSK_RTMP --> DSK_IN

    BAGT <-->|SSE + HTTP| lcytBackend
    BAGT <-->|TCP| TCP
    TCP -->|PTZ commands| CAM1 & CAM2
    TCP -->|source switch| MIX
`;

const CAPTION_FLOW = `
flowchart LR
    subgraph Input["Caption Sources"]
        direction TB
        TYPE["Manual typing\\nin Input Bar"]
        SPEECH["Browser STT\\nWeb Speech API"]
        FILE["Script file\\n.txt / .lcyt\\nstep line-by-line"]
        STTAUTO["Server STT\\nfrom RTMP / HLS audio"]
    end

    subgraph Processing["Backend Processing"]
        direction TB
        META["Metacode processor\\nstrips graphics: cue: tags"]
        QUEUE["_sendQueue\\nserialised — monotonic seq#"]
        DSK_PROC["DSK processor\\ngraphics metacodes → SSE"]
        CUE_PROC["Cue processor\\ncue metacodes → auto-advance"]
    end

    subgraph Targets["Delivery Targets"]
        direction TB
        YT["YouTube Live\\nHTTP POST /caption_ingestion/v1\\nstream key per target"]
        VIEW["Viewer SSE\\nGET /viewer/:key\\npublic — CORS *"]
        GEN["Generic HTTP\\nPOST to webhook URL\\ncustom headers"]
    end

    subgraph Feedback["Delivery Feedback"]
        SSE_OUT["GET /events\\nSSE stream"]
        LOG["Sent log in UI\\n✓ green = delivered\\n✗ red = error"]
    end

    TYPE & SPEECH & FILE & STTAUTO --> META
    META --> QUEUE & DSK_PROC & CUE_PROC
    QUEUE --> YT & VIEW & GEN
    YT & VIEW & GEN --> SSE_OUT --> LOG
`;

function Section({ title, description, chart }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{title}</h2>
      {description && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
          {description}
        </p>
      )}
      <div style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: 20,
        background: 'var(--color-surface)',
        overflowX: 'auto',
      }}>
        <MermaidChart chart={chart} />
      </div>
    </section>
  );
}

export function ProductionVisualPage() {
  return (
    <div style={{ padding: '20px 24px', maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Signal Flow — Visual</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
          Live diagrams of how video, audio, and caption signals move through the system.
        </p>
      </div>

      <Section
        title="Full Video Signal Flow"
        description="End-to-end path from cameras through the mixer and encoder, through MediaMTX, to all backend outputs and YouTube."
        chart={VIDEO_SIGNAL_FLOW}
      />

      <Section
        title="Caption Pipeline"
        description="How captions flow from every input source through backend processing to all delivery targets."
        chart={CAPTION_FLOW}
      />
    </div>
  );
}
