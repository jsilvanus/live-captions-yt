# lcyt-music — Music Detection Plugin

Audio classification and BPM estimation plugin. Detects when music is playing in audio streams (server-side HLS or client-side browser mic) and emits metacode signals that feed into the caption pipeline.

**Version:** 0.1.0  
**License:** MIT

## Overview

lcyt-music provides:
- **Audio classification** — Classify audio into `music / speech / silence`
- **BPM estimation** — Real-time beats-per-minute calculation
- **Server-side path** — Analyze HLS segments from MediaMTX
- **Client-side path** — Analyze browser microphone via Web Audio API
- **Metacode emission** — `<!-- sound:music -->`, `<!-- bpm:128 -->` markers
- **SSE events** — Real-time `sound_label` and `bpm_update` events

## Installation

```bash
npm install lcyt-music
```

## Quick Start

In `lcyt-backend`:

```javascript
import { initMusicControl, createSoundCaptionProcessor } from 'lcyt-music';

const { musicManager } = await initMusicControl(db);

// Inject processor into captions route
const soundProcessor = createSoundCaptionProcessor({ store, db, musicManager });

// The processor handles <!-- sound:... --> and <!-- bpm:... --> metacodes
```

## Metacode Syntax

Captions and the audio analysis pipeline emit sound metacodes:

```
<!-- sound:music -->        Audio is music
<!-- sound:speech -->       Audio is speech (or mixed/predominantly speech)
<!-- sound:silence -->      Audio is silent
<!-- bpm:128 -->            Current BPM estimate (integer; emitted when label=music)
```

Multiple metacodes in a single caption:

```
<!-- sound:music --> <!-- bpm:128 -->
```

These metacodes are never sent to YouTube — they're stripped by the caption processor and converted to SSE events.

## Audio Sources

### Server-side (HLS segments)

Analyzes incoming HLS stream from MediaMTX:

```
MediaMTX fMP4 HLS
    ↓
lcyt-music plugin
    ↓
Audio classification → label + BPM
    ↓
Inject into session._sendQueue
    ↓
<!-- sound:music --> <!-- bpm:128 -->
```

**Setup:**

```bash
# Ensure rtmp plugin and music plugin are initialized
initMusicControl(db);
```

Music detection automatically subscribes to HLS segments if available.

### Client-side (Browser microphone)

Analyzes browser mic via Web Audio API:

```
Browser Microphone (Web Audio API)
    ↓
lcyt-web useMusicDetector hook
    ↓
Audio classification → label + BPM
    ↓
captionContext.send('<!-- sound:music --> <!-- bpm:128 -->')
    ↓
Same SSE event pipeline
```

**Setup (in lcyt-web):**

```javascript
const { label, bpm } = useMusicDetector({
  enabled: true,
  confidenceThreshold: 0.7
});

// Manually emit captions
captionContext.send(`<!-- sound:${label} --> <!-- bpm:${bpm} -->`);
```

## API Routes

No explicit routes; music detection is passive. Instead, it:
1. Listens for captions with `<!-- sound:... -->` metacodes
2. Updates per-API-key `soundState`
3. Emits SSE events on `GET /events`

## SSE Events

On `GET /events`, music detection emits:

```json
{
  "type": "sound_label",
  "data": {
    "label": "music",
    "previous": "speech",
    "confidence": 0.95,
    "ts": "2026-06-26T12:00:00.000"
  }
}
```

```json
{
  "type": "bpm_update",
  "data": {
    "bpm": 128,
    "confidence": 0.88,
    "ts": "2026-06-26T12:00:00.050"
  }
}
```

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MUSIC_ENABLED` | unset | Enable music detection |
| `MUSIC_CONFIDENCE_THRESHOLD` | 0.7 | Min confidence (0–1) to emit |
| `MUSIC_BPM_CHANGE_THRESHOLD` | 2 | Min BPM change before emitting event |

### Database Schema

```sql
-- Per-API-key sound state (current label + BPM)
CREATE TABLE sound_state (
  api_key TEXT PRIMARY KEY,
  label TEXT,                -- 'music', 'speech', 'silence'
  bpm INTEGER,
  confidence REAL,
  updated_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);

-- Sound classification events (audit)
CREATE TABLE sound_events (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  label TEXT,
  previous_label TEXT,
  bpm INTEGER,
  confidence REAL,
  source TEXT,              -- 'server' (HLS) or 'client' (browser mic)
  timestamp DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);
```

## Use Cases

### 1. Mute STT During Music

When `sound_label` is `music`, suppress STT output or discard low-confidence transcripts:

```javascript
// Frontend
if (soundLabel === 'music') {
  // Skip STT or mark as low-priority
  return;
}
```

### 2. Signal Music Presence to Overlays

DSK graphics can react to music detection:

```
<!-- sound:music -->
(DSK receives sound_label event)
(Overlays can change style, show visual cue, etc.)
```

### 3. Production Cue Light

Show operator a visual indicator when music is detected:

```javascript
// Frontend: Show red/green cue light based on soundLabel
<div className={`cue-light ${soundLabel === 'music' ? 'active' : ''}`} />
```

### 4. BPM Display

Display current BPM for producers timing transitions to beat:

```javascript
// Frontend
<span>{bpm} BPM</span>  // Updates when sound_label=music
```

## Integration with Other Plugins

**Cue Engine** (`lcyt-cues`):
- Provides sound cue listeners that trigger on `music_start`, `music_stop`
- `createSoundCueListener` auto-subscribes to `sound_label` events

**DSK Graphics** (`lcyt-dsk`):
- Receives `sound_label` events via SSE
- Can use events in templates/overlays

## Testing

```bash
npm test -w packages/plugins/lcyt-music
```

Tests cover:
- Metacode extraction (`<!-- sound:... -->`)
- Sound state updates
- SSE event emission
- BPM change detection (threshold enforcement)
- Label transition tracking

## Client-side (lcyt-web)

The `useMusicDetector` hook in lcyt-web handles:
- Microphone permission requests
- Web Audio API analysis
- Real-time classification
- BPM calculation
- Manual caption emission

Usage:

```javascript
import { useMusicDetector } from 'lcyt-web/hooks/useMusicDetector';

const { label, bpm, confidence, isListening } = useMusicDetector({
  enabled: audioOn,
  confidenceThreshold: 0.7
});
```

## Limitations

- **No song identification** — No Shazam-style fingerprinting
- **No copyright detection** — Not for DMCA/rights management
- **Accuracy depends on training** — Model quality varies by audio
- **Client-side requires mic permission** — User must grant access

## See Also

- [Cue Engine documentation](../lcyt-cues/README.md)
- [DSK Graphics documentation](../lcyt-dsk/README.md)
- [LCYT backend documentation](../../lcyt-backend/README.md)
- [Frontend Music Detection](../../lcyt-web/hooks/useMusicDetector.js)
- [Plan: Music Detection](../../docs/plans/plan_music.md)
