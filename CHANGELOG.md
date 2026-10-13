# Changelog

## Unreleased

### Deprecated
- nginx-rtmp callbacks `POST /rtmp`, `/feed-rtmp` and `/dsk-rtmp` (including the `/on_publish` and `/on_publish_done` sub-paths). They keep working but now send `Deprecation: true` with a `Link` to the removal plan and log a warning. MediaMTX replaces nginx-rtmp; see `docs/plans/plan_nginx_rtmp_deprecation.md`.
