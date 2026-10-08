# LCYT Database Schema Overview

## Entity Relationship Diagram (Conceptual)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                           USERS & AUTHENTICATION                            â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚
â”‚  users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”œâ”€ id (PK)         â”‚
â”‚  â”œâ”€ email (UNIQUE)  â”‚
â”‚  â”œâ”€ password_hash   â”‚
â”‚  â”œâ”€ name            â”‚
â”‚  â”œâ”€ active          â”‚
â”‚  â”œâ”€ is_admin        â”‚
â”‚  â””â”€ created_at      â”‚
â”‚       â”‚
â”‚       â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                          â”‚
â”‚  api_keys                        org_members
â”‚  â”œâ”€ id (PK)                      â”œâ”€ id (PK)
â”‚  â”œâ”€ key (UNIQUE)                 â”œâ”€ org_id (FK)
â”‚  â”œâ”€ user_id (FK)                 â”œâ”€ user_id (FK)
â”‚  â”œâ”€ org_id (FK) â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”œâ”€ role
â”‚  â”œâ”€ owner                 â”‚      â”œâ”€ invited_by (FK)
â”‚  â”œâ”€ created_at            â”‚      â””â”€ joined_at
â”‚  â”œâ”€ expires_at            â”‚
â”‚  â”œâ”€ active                â”‚
â”‚  â”œâ”€ daily_limit           â”‚
â”‚  â”œâ”€ lifetime_limit        â”‚      organizations
â”‚  â”œâ”€ lifetime_used         â”‚      â”œâ”€ id (PK)
â”‚  â””â”€ sequence              â”‚      â”œâ”€ name
â”‚                           â”‚      â”œâ”€ slug (UNIQUE)
â”‚                           â””â”€â”€â”€â”€â”€â†’â”œâ”€ owner_user_id (FK)
â”‚                                  â””â”€ created_at
â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                         PROJECTS & TARGETS                                  â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚
â”‚  api_keys (project record)
â”‚  â””â”€ Represents both auth token AND project configuration
â”‚     â”œâ”€ Points to user/org owner
â”‚     â””â”€ References multiple caption_targets
â”‚
â”‚       â†“
â”‚  caption_targets â”€â”€â”€â”€ (1:many) â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”œâ”€ id (PK)                            â”‚
â”‚  â”œâ”€ api_key_id (FK)                    â”‚
â”‚  â”œâ”€ type (youtube|viewer|generic)      â”‚ One project can deliver
â”‚  â”œâ”€ config (JSON: streamKey, URL, etc) â”‚ to multiple targets
â”‚  â”œâ”€ enabled                            â”‚ simultaneously
â”‚  â””â”€ created_at                         â”‚
â”‚                                        â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                         CAPTION FLOW & USAGE                                â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚
â”‚  caption_usage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”œâ”€ id (PK)                      â”‚
â”‚  â”œâ”€ api_key_id (FK)              â”‚  Per-project daily counters
â”‚  â”œâ”€ date (DATE)                  â”‚  for billing/limits
â”‚  â”œâ”€ character_count              â”‚
â”‚  â”œâ”€ caption_count                â”‚
â”‚  â””â”€ session_count                â”‚
â”‚                                  â”‚
â”‚  caption_errors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  Error tracking for
â”‚  â”œâ”€ id (PK)                      â”‚  debugging & monitoring
â”‚  â”œâ”€ api_key_id (FK)              â”‚
â”‚  â”œâ”€ error_type                   â”‚
â”‚  â”œâ”€ error_message                â”‚
â”‚  â”œâ”€ occurred_at                  â”‚
â”‚  â””â”€ source (YouTube/generic/etc) â”‚
â”‚
â”‚  usage_rollups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  Hourly â†’ daily compaction
â”‚  â”œâ”€ id (PK)                      â”‚  for long-term retention
â”‚  â”œâ”€ api_key_id (FK)              â”‚
â”‚  â”œâ”€ period (hourly/daily)        â”‚
â”‚  â”œâ”€ date                         â”‚
â”‚  â””â”€ character_count              â”‚
â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                         ACCESS CONTROL                                      â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚
â”‚  site_feature_policies â”€â”€â”
â”‚  â”œâ”€ feature_code (PK)    â”‚  Organization-level (can override)
â”‚  â”œâ”€ mode                 â”‚  AND project-level (can further override)
â”‚  â””â”€ updated_at           â”‚
â”‚       â†“                  â”‚
â”‚  org_feature_overrides   â”‚
â”‚  â”œâ”€ org_id (FK)          â”‚
â”‚  â”œâ”€ feature_code         â”‚
â”‚  â””â”€ mode                 â”‚
â”‚       â†“
â”‚  project_features â”€â”€â”€â”€â”€â”€â”€â”¤  Per-project feature toggles
â”‚  â”œâ”€ api_key_id (FK)      â”‚  (overrides org-level)
â”‚  â”œâ”€ feature_code         â”‚
â”‚  â”œâ”€ mode                 â”‚
â”‚  â””â”€ set_at               â”‚
â”‚
â”‚  project_members â”€â”€â”€â”€â”€â”€â”€â”€â”¤  Fine-grained per-project roles
â”‚  â”œâ”€ api_key_id (FK)      â”‚  (viewer / editor / admin)
â”‚  â”œâ”€ user_id (FK)         â”‚
â”‚  â”œâ”€ role                 â”‚
â”‚  â””â”€ granted_at           â”‚
â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    STREAMING & MEDIA                                        â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚
â”‚  hls_session_metadata â”€â”€â”€â”
â”‚  â”œâ”€ id (PK)              â”‚  HLS streaming session
â”‚  â”œâ”€ api_key_id (FK)      â”‚  state (lcyt-rtmp plugin)
â”‚  â”œâ”€ state (recording/live)
â”‚  â”œâ”€ started_at           â”‚
â”‚  â””â”€ metadata (JSON)      â”‚
â”‚
â”‚  preview_active â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  Live preview stream tracking
â”‚  â”œâ”€ id (PK)              â”‚
â”‚  â”œâ”€ api_key_id (FK)      â”‚
â”‚  â””â”€ stream_path          â”‚
â”‚
â”‚  radio_active â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  Audio-only stream tracking
â”‚  â”œâ”€ id (PK)              â”‚
â”‚  â”œâ”€ api_key_id (FK)      â”‚
â”‚  â””â”€ stream_path          â”‚
â”‚
â”‚  videos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  VOD metadata
â”‚  â”œâ”€ id (PK)              â”‚
â”‚  â”œâ”€ api_key_id (FK)      â”‚
â”‚  â”œâ”€ title                â”‚
â”‚  â”œâ”€ path                 â”‚
â”‚  â”œâ”€ duration_ms          â”‚
â”‚  â”œâ”€ created_at           â”‚
â”‚  â””â”€ metadata (JSON)      â”‚
â”‚
â”‚  viewer_tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  Embedded viewer authentication
â”‚  â”œâ”€ id (PK)              â”‚
â”‚  â”œâ”€ token (UNIQUE)       â”‚
â”‚  â”œâ”€ api_key_id (FK)      â”‚
â”‚  â”œâ”€ expires_at           â”‚
â”‚  â””â”€ viewer_label         â”‚
â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    EVENTS & AUDIT LOGS                                      â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚
â”‚  bus_events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”œâ”€ id (PK)                       â”‚  Real-time event stream
â”‚  â”œâ”€ event_type                    â”‚  (captions sent, targets changed, etc)
â”‚  â”œâ”€ data (JSON)                   â”‚  Pub/Sub via SSE; retention policy
â”‚  â”œâ”€ happened_at                   â”‚  (e.g., 30 days)
â”‚  â””â”€ user_id (FK, nullable)        â”‚
â”‚
â”‚  audit_log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  Detailed action trail
â”‚  â”œâ”€ id (PK)                       â”‚  (user created key, org added member, etc)
â”‚  â”œâ”€ action                        â”‚  Searchable by org_id / user_id / action
â”‚  â”œâ”€ org_id (FK, nullable)         â”‚  Retention: 1 year (GDPR)
â”‚  â”œâ”€ user_id (FK, nullable)        â”‚
â”‚  â”œâ”€ api_key_id (FK, nullable)     â”‚
â”‚  â”œâ”€ description                   â”‚
â”‚  â”œâ”€ changes (JSON)                â”‚
â”‚  â””â”€ created_at                    â”‚
â”‚
â”‚  event_log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  Structured event tracking
â”‚  â”œâ”€ id (PK)                       â”‚  (MCP events, perception updates, etc)
â”‚  â”œâ”€ event_type                    â”‚  Indexed by timestamp + type
â”‚  â”œâ”€ api_key_id (FK, nullable)     â”‚
â”‚  â”œâ”€ payload (JSON)                â”‚
â”‚  â””â”€ created_at                    â”‚
â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    MCP & TOKENS                                             â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚
â”‚  mcp_tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”œâ”€ id (PK)                        â”‚  MCP server authentication
â”‚  â”œâ”€ token (UNIQUE)                 â”‚  (issued by backend, validated by
â”‚  â”œâ”€ user_id (FK, nullable)         â”‚   tools running in MCP context)
â”‚  â”œâ”€ org_id (FK, nullable)          â”‚
â”‚  â”œâ”€ api_key_id (FK, nullable)      â”‚
â”‚  â”œâ”€ scope (capabilities)           â”‚
â”‚  â”œâ”€ created_at                     â”‚
â”‚  â”œâ”€ expires_at                     â”‚
â”‚  â””â”€ last_used_at                   â”‚
â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    SETTINGS & CONFIGURATION                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚
â”‚  server_settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”œâ”€ key (PK)                       â”‚  Deployment-wide KV settings
â”‚  â”œâ”€ value                          â”‚  Hot-reloadable via Admin UI
â”‚  â”œâ”€ type (string/int/bool/json)   â”‚  Examples: SESSION_TTL, JWT_SECRET, etc
â”‚  â”œâ”€ updated_at                     â”‚
â”‚  â””â”€ updated_by (FK, nullable)      â”‚
â”‚
â”‚  session_stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  Per-project session metrics
â”‚  â”œâ”€ id (PK)                        â”‚  (tracked for analytics)
â”‚  â”œâ”€ api_key_id (FK)                â”‚
â”‚  â”œâ”€ session_id (from runtime)      â”‚
â”‚  â”œâ”€ duration_ms                    â”‚
â”‚  â”œâ”€ caption_count                  â”‚
â”‚  â”œâ”€ error_count                    â”‚
â”‚  â””â”€ ended_at                       â”‚
â”‚
â”‚  translation_config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  Per-project i18n config
â”‚  â”œâ”€ id (PK)                         â”‚
â”‚  â”œâ”€ api_key_id (FK)                 â”‚
â”‚  â”œâ”€ source_lang                     â”‚
â”‚  â”œâ”€ target_langs (JSON)             â”‚
â”‚  â””â”€ provider (Google/DeepL/etc)    â”‚
â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                PLUGIN-OWNED TABLES (Partial)                               â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚
â”‚  â”Œâ”€ lcyt-dsk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”‚ â”œâ”€ dsk_templates          â”‚  Graphics overlay templates
â”‚  â”‚ â”œâ”€ dsk_jobs               â”‚  Rendering jobs
â”‚  â”‚ â””â”€ dsk_* (render state)   â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
â”‚
â”‚  â”Œâ”€ lcyt-files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”‚ â”œâ”€ file_storage_config    â”‚  File backend configuration
â”‚  â”‚ â”œâ”€ files                  â”‚  Caption file references
â”‚  â”‚ â””â”€ file_* (per-backend)   â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
â”‚
â”‚  â”Œâ”€ lcyt-cues â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”‚ â”œâ”€ cue_patterns           â”‚  Cue definitions
â”‚  â”‚ â”œâ”€ cue_matches            â”‚  Matched cues (event records)
â”‚  â”‚ â””â”€ cue_* (config)         â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
â”‚
â”‚  â”Œâ”€ lcyt-rtmp â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”‚ â”œâ”€ (see hls_*, preview_*, radio_* above)
â”‚  â”‚ â””â”€ additional RTMP state  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
â”‚
â”‚  â”Œâ”€ lcyt-production â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â”‚ â”œâ”€ device_roles           â”‚  Camera / mixer roles
â”‚  â”‚ â”œâ”€ device_* (state)       â”‚
â”‚  â”‚ â””â”€ production_* (config)  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

## Table Counts by Category

| Category | Count | Tables |
|---|---|---|
| **User & Auth** | 4 | `users`, `api_keys`, `organizations`, `org_members` |
| **Projects & Access** | 5 | `caption_targets`, `project_features`, `project_members`, `site_feature_policies`, `org_feature_overrides` |
| **Usage & Billing** | 3 | `caption_usage`, `usage_rollups`, `caption_errors` |
| **Streaming & Media** | 5 | `hls_session_metadata`, `preview_active`, `radio_active`, `videos`, `viewer_tokens` |
| **Events & Audit** | 3 | `bus_events`, `audit_log`, `event_log` |
| **Configuration** | 3 | `server_settings`, `session_stats`, `translation_config` |
| **MCP & Tokens** | 1 | `mcp_tokens` |
| **Plugin-owned** | 20+ | DSK, Files, Cues, RTMP, Production, Device roles, etc. |
| **Helper/Sequence** | 2 | `sequences`, `broadcasts` |
| **Other** | 3+ | `arming`, `device_roles`, `mcp_topics` |
| **TOTAL** | **48+** | Growing as plugins add tables |

## Key Indexes

To improve query performance, critical indexes include:

```sql
-- User lookup (auth performance)
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_api_keys_key ON api_keys(key);

-- Organization queries
CREATE INDEX idx_org_members_org ON org_members(org_id);
CREATE INDEX idx_org_members_user ON org_members(user_id);

-- Project access
CREATE INDEX idx_caption_targets_api_key ON caption_targets(api_key_id);
CREATE INDEX idx_caption_usage_api_key_date ON caption_usage(api_key_id, date);

-- Audit trail queries
CREATE INDEX idx_audit_log_org ON audit_log(org_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(created_at DESC);

-- Event streaming
CREATE INDEX idx_bus_events_timestamp ON bus_events(happened_at DESC);
CREATE INDEX idx_event_log_timestamp ON event_log(created_at DESC);
```

## PostgreSQL Optimizations (Post-Migration)

After migrating to PostgreSQL, additional optimizations become available:

```sql
-- JSONB columns for flexible metadata
ALTER TABLE hls_session_metadata ADD COLUMN metadata JSONB;
CREATE INDEX idx_hls_metadata ON hls_session_metadata USING GIN(metadata);

-- Partitioning for large tables (caption_usage, audit_log)
CREATE TABLE caption_usage_y2025m01 PARTITION OF caption_usage
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Full-text search on audit descriptions
CREATE INDEX idx_audit_log_fts ON audit_log 
  USING GIN(to_tsvector('english', description));

-- Range queries on timestamps
CREATE INDEX idx_event_log_timestamp_range ON event_log
  USING BRIN(created_at);  -- BRIN index for large tables
```

---

## Migration Complexity by Table

| Table | Size | Refs | Complexity |
|---|---|---|---|
| `users` | Small | Many FK | Medium |
| `api_keys` | Medium | Many FK | High (project model) |
| `organizations` | Small | Many FK | Low |
| `caption_usage` | Large | 1 FK | High (partitioning) |
| `caption_targets` | Medium | 1 FK | Medium |
| `audit_log` | Large | 3+ FK | High (retention/archival) |
| `bus_events` | Large | 1 FK | High (streaming/partitioning) |
| Plugin tables | Varies | Varies | Varies |

**Note:** Tables with many foreign keys or large row counts benefit most from PostgreSQL migration.

---

See also: [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md), [docs/plans/plan_postgres_migration.md](docs/plans/plan_postgres_migration.md)

