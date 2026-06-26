# lcyt-dsk — DSK Graphics Plugin

Playwright-based headless Chromium renderer for DSK (Downstream Key) graphics overlays. Manages template rendering, image upload, overlay broadcasting, and RTMP output for live graphics production.

**Version:** 0.1.0  
**License:** MIT

## Overview

lcyt-dsk provides:
- **Template rendering** — JSON-defined layouts rendered to Chromium
- **Graphics overlays** — Layer-based composition (text, rectangles, images)
- **Live data broadcasting** — Push real-time caption data to overlays
- **RTMP streaming** — Stream rendered graphics to nginx-rtmp
- **Image management** — Upload and serve overlay images
- **Viewport system** — Multiple display regions (landscape, vertical, etc.)

## Installation

```bash
npm install lcyt-dsk
```

## Quick Start

In `lcyt-backend`:

```javascript
import { initDskControl, createDskRouters } from 'lcyt-dsk';

const { captionProcessor, stop: stopDsk } = await initDskControl(db, store, relayManager);
const { dskRouter, dskTemplatesRouter, dskViewportsRouter, imagesRouter, dskRtmpRouter } =
  createDskRouters(db, store, auth, relayManager);

app.use('/dsk', dskRouter);
app.use('/dsk', dskTemplatesRouter);
app.use('/dsk', dskViewportsRouter);
app.use('/images', imagesRouter);
app.use('/dsk-rtmp', dskRtmpRouter);

// On shutdown
await stopDsk();
```

## API Routes

```
GET  /dsk/:apikey/images
     List overlay images for API key
     Response: [{ id, name, url, size, created_at }]

GET  /dsk/:apikey/events
     SSE stream of graphics events
     Response: text/event-stream

GET  /dsk/:apikey/viewports/public
     List public viewport definitions
     Response: [{ id, name, width, height }]

GET/POST/PUT/DELETE /dsk/:apikey/templates
     Template CRUD (full list, create, update, delete)
     Response: [{ id, name, layers, created_at }]

POST /dsk/:apikey/templates/:id/activate
     Activate template in renderer
     Response: 200 { ok: true }

POST /dsk/:apikey/template
     Render one-off template immediately
     Body: { template, data }
     Response: 200

POST /dsk/:apikey/broadcast
     Push live data to active template
     Body: { text, speaker, timecode }
     Response: 200

GET  /dsk/:apikey/renderer/status
     Renderer running state (started, idle, streaming)
     Response: { status, activeTemplate, streaming }

POST /dsk/:apikey/renderer/start
     Start RTMP capture for key
     Response: 200

POST /dsk/:apikey/renderer/stop
     Stop RTMP capture for key
     Response: 200

GET/POST/PUT/DELETE /dsk/:apikey/viewports
     Viewport CRUD
     Response: [{ id, name, width, height }]

GET/POST/PUT/DELETE /images/:id
     Image upload/management for overlays
```

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLAYWRIGHT_DSK_CHROMIUM` | Playwright cache | Path to Chromium binary |
| `DSK_LOCAL_SERVER` | `http://localhost:$PORT` | Server URL for renderer |
| `DSK_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | nginx-rtmp base URL |
| `DSK_RTMP_APP` | `live` | RTMP application name |
| `GRAPHICS_DIR` | `/data/images` | Image storage directory |
| `GRAPHICS_ENABLED` | unset | Enable image upload/management |
| `GRAPHICS_MAX_FILE_BYTES` | 5242880 (5 MB) | Max image file size |
| `GRAPHICS_MAX_STORAGE_BYTES` | 52428800 (50 MB) | Max storage per API key |

### Docker Rendering

Alternative: Run renderer in Docker container:

```bash
docker build -f docker/lcyt-dsk-renderer/Dockerfile -t lcyt-dsk-renderer .
docker run lcyt-dsk-renderer
```

Set `DSK_RENDERER_CONTAINER=true` to use Docker mode.

## Template Format

Templates are JSON objects defining layers:

```json
{
  "id": "template-1",
  "name": "Landscape Title",
  "width": 1920,
  "height": 1080,
  "layers": [
    {
      "type": "text",
      "id": "title",
      "text": "{{ caption }}",
      "x": 100,
      "y": 50,
      "width": 1720,
      "fontSize": 48,
      "color": "#ffffff",
      "fontFamily": "Arial"
    },
    {
      "type": "rect",
      "id": "background",
      "x": 0,
      "y": 0,
      "width": 1920,
      "height": 200,
      "fill": "#000000",
      "opacity": 0.8
    },
    {
      "type": "image",
      "id": "logo",
      "imageId": "logo-123",
      "x": 1700,
      "y": 900,
      "width": 200,
      "height": 150
    }
  ]
}
```

**Layer types:**
- `text` — Text rendering with CSS styling
- `rect` — Rectangle/box shapes
- `image` — Reference uploaded image by ID

## Graphics Metacodes

Captions can embed graphics metacodes to trigger overlay changes:

```
<!-- graphics:logo,banner -->              all viewports: logo + banner
<!-- graphics[vertical-left]:stanza,logo -->  vertical-left: stanza + logo
<!-- graphics[v1,v2]:stanza -->               v1 AND v2: stanza
<!-- graphics[landscape]: -->                landscape: nothing (clear)
<!-- graphics:+logo -->                      add logo (delta mode)
<!-- graphics:-banner -->                    remove banner (delta)
```

The `captionProcessor` extracts these codes, updates active graphics, and emits SSE events.

## SSE Events

On `GET /dsk/:apikey/events`:

```json
{
  "type": "graphics",
  "data": {
    "default": ["logo", "banner"],
    "viewports": {
      "vertical-left": ["stanza", "logo"],
      "landscape": ["title-background"]
    },
    "ts": 1719400800000
  }
}
```

```json
{
  "type": "bindings",
  "data": {
    "codes": {
      "section": "intro",
      "speaker": "alice",
      "theme": "music"
    },
    "ts": 1719400800000
  }
}
```

## Rendering Pipeline

```
Captions with graphics: metacodes
         ↓
   captionProcessor
         ↓
 SSE graphics events
         ↓
 DSK page (wouter /dsk/:key)
         ↓
  WebSocket to renderer.js
         ↓
 Playwright Chromium
         ↓
 ffmpeg → RTMP → nginx-rtmp
```

## Database Schema

```sql
CREATE TABLE dsk_templates (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  name TEXT,
  template JSONB,           -- Full template definition
  created_at DATETIME,
  updated_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);

CREATE TABLE dsk_viewports (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  name TEXT,
  width INTEGER,
  height INTEGER,
  is_public BOOLEAN,
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);

CREATE TABLE image_files (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  name TEXT,
  size_bytes INTEGER,
  mime_type TEXT,
  storage_path TEXT,        -- Full path or S3 key
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);
```

## Testing

```bash
npm test -w packages/plugins/lcyt-dsk
```

Tests cover:
- Template rendering (with mock Playwright)
- Graphics metacode extraction
- SSE event emission
- Image upload/management
- Viewport CRUD

## See Also

- [DSK page (frontend)](../../lcyt-web/) — `/graphics/editor`, `/graphics/control`, `/dsk/:key`
- [Graphics metacode system](../../docs/METACODE.md)
- [LCYT backend documentation](../../lcyt-backend/README.md)
- [Plan: DSK Graphics](../../docs/plans/plan_dsk.md)
