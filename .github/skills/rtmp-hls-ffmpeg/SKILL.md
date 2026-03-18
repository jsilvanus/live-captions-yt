---
name: rtmp-hls-ffmpeg
summary: |
  RTMP / HLS / ffmpeg skill: ffmpeg invocation patterns, HLS segmenting,
  WebVTT sidecars, and thumbnail/preview pipelines.
---

## Purpose
Runbook and safe invocation tips for all ffmpeg-related flows (HLS, preview,
subtitle segmenting) used by the backend.

## When to use
- Starting/stopping ffmpeg jobs, tuning HLS segment durations, or writing WebVTT sidecars.
- Debugging ffmpeg errors or platform path issues.

## Checklist
- Probe ffmpeg binary at startup and surface clear error messages.
- Use absolute paths and isolated temp dirs for per-key outputs.
- Segment duration: match HLS_SUBS_SEGMENT_DURATION; keep window size limited.
- Thumbnail: produce single JPEG with consistent size; handle If-Modified-Since.

## Useful commands
- Probe:

```bash
ffmpeg -version
```

- Example ffmpeg args should be kept in a shared helper to ease testing.

## Outputs
- Safe ffmpeg arg templates, HLS tuning notes, sidecar writer helpers.
