---
name: dsk-renderer
summary: |
  DSK Renderer skill: Playwright-based Chromium rendering, template pipelines,
  ffmpeg RTMP streaming, and overlay testing.
---

## Purpose
Guidance to maintain the headless renderer (`packages/plugins/lcyt-dsk`),
manage templates, and stream overlays to nginx-rtmp via ffmpeg.

## When to use
- Adding renderer API features, updating template JSON shape, or fixing ffmpeg streams.
- Building tests for renderer start/stop and template rendering.

## Checklist
- Use Playwright with a persistent Chromium instance; isolate per-key pages.
- Validate template JSON (layers) strictly and provide helpful errors.
- ffmpeg: spawn with safe args, validate exit codes, reconnect/backoff.
- Provide preview pages for template designers.

## Commands
- Start renderer locally (dev): follow package README; ensure `PLAYWRIGHT_DSK_CHROMIUM` set.

## Outputs
- Template validation helpers, renderer health checks, RTMP start/stop helpers.
