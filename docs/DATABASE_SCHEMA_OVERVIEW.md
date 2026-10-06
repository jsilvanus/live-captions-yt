# LCYT Database Schema Overview

## Entity Relationship Diagram (Conceptual)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USERS & AUTHENTICATION                            │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  users ─────────────┐
│  ├─ id (PK)         │
│  ├─ email (UNIQUE)  │
│  ├─ password_hash   │
│  ├─ name            │
│  ├─ active          │
│  ├─ is_admin        │
│  └─ created_at      │
│       │
│       └──────────────────────────────────┐
│                                          │
│  api_keys                        org_members
│  ├─ id (PK)                      ├─ id (PK)
│  ├─ key (UNIQUE)                 ├─ org_id (FK)
│  ├─ user_id (FK)                 ├─ user_id (FK)
│  ├─ org_id (FK) ◄─────────┐      ├─ role
│  ├─ owner                 │      ├─ invited_by (FK)
│  ├─ created_at            │      └─ joined_at
│  ├─ expires_at            │
│  ├─ active                │
│  ├─ daily_limit           │
│  ├─ lifetime_limit        │      organizations
│  ├─ lifetime_used         │      ├─ id (PK)
│  └─ sequence              │      ├─ name
│                           │      ├─ slug (UNIQUE)
│                           └─────→├─ owner_user_id (FK)
│                                  └─ created_at
│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROJECTS & TARGETS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  api_keys (project record)
│  └─ Represents both auth token AND project configuration
│     ├─ Points to user/org owner
│     └─ References multiple caption_targets
│
│       ↓
│  caption_targets ──── (1:many) ────────┐
│  ├─ id (PK)                            │
│  ├─ api_key_id (FK)                    │
│  ├─ type (youtube|viewer|generic)      │ One project can deliver
│  ├─ config (JSON: streamKey, URL, etc) │ to multiple targets
│  ├─ enabled                            │ simultaneously
│  └─ created_at                         │
│                                        │
└────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         CAPTION FLOW & USAGE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  caption_usage ──────────────────┐
│  ├─ id (PK)                      │
│  ├─ api_key_id (FK)              │  Per-project daily counters
│  ├─ date (DATE)                  │  for billing/limits
│  ├─ character_count              │
│  ├─ caption_count                │
│  └─ session_count                │
│                                  │
│  caption_errors ─────────────────┤  Error tracking for
│  ├─ id (PK)                      │  debugging & monitoring
│  ├─ api_key_id (FK)              │
│  ├─ error_type                   │
│  ├─ error_message                │
│  ├─ occurred_at                  │
│  └─ source (YouTube/generic/etc) │
│
│  usage_rollups ──────────────────┤  Hourly → daily compaction
│  ├─ id (PK)                      │  for long-term retention
│  ├─ api_key_id (FK)              │
│  ├─ period (hourly/daily)        │
│  ├─ date                         │
│  └─ character_count              │
│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         ACCESS CONTROL                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  site_feature_policies ──┐
│  ├─ feature_code (PK)    │  Organization-level (can override)
│  ├─ mode                 │  AND project-level (can further override)
│  └─ updated_at           │
│       ↓                  │
│  org_feature_overrides   │
│  ├─ org_id (FK)          │
│  ├─ feature_code         │
│  └─ mode                 │
│       ↓
│  project_features ───────┤  Per-project feature toggles
│  ├─ api_key_id (FK)      │  (overrides org-level)
│  ├─ feature_code         │
│  ├─ mode                 │
│  └─ set_at               │
│
│  project_members ────────┤  Fine-grained per-project roles
│  ├─ api_key_id (FK)      │  (viewer / editor / admin)
│  ├─ user_id (FK)         │
│  ├─ role                 │
│  └─ granted_at           │
│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    STREAMING & MEDIA                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  hls_session_metadata ───┐
│  ├─ id (PK)              │  HLS streaming session
│  ├─ api_key_id (FK)      │  state (lcyt-rtmp plugin)
│  ├─ state (recording/live)
│  ├─ started_at           │
│  └─ metadata (JSON)      │
│
│  preview_active ─────────┤  Live preview stream tracking
│  ├─ id (PK)              │
│  ├─ api_key_id (FK)      │
│  └─ stream_path          │
│
│  radio_active ───────────┤  Audio-only stream tracking
│  ├─ id (PK)              │
│  ├─ api_key_id (FK)      │
│  └─ stream_path          │
│
│  videos ─────────────────┤  VOD metadata
│  ├─ id (PK)              │
│  ├─ api_key_id (FK)      │
│  ├─ title                │
│  ├─ path                 │
│  ├─ duration_ms          │
│  ├─ created_at           │
│  └─ metadata (JSON)      │
│
│  viewer_tokens ──────────┤  Embedded viewer authentication
│  ├─ id (PK)              │
│  ├─ token (UNIQUE)       │
│  ├─ api_key_id (FK)      │
│  ├─ expires_at           │
│  └─ viewer_label         │
│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    EVENTS & AUDIT LOGS                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  bus_events ──────────────────────┐
│  ├─ id (PK)                       │  Real-time event stream
│  ├─ event_type                    │  (captions sent, targets changed, etc)
│  ├─ data (JSON)                   │  Pub/Sub via SSE; retention policy
│  ├─ happened_at                   │  (e.g., 30 days)
│  └─ user_id (FK, nullable)        │
│
│  audit_log ────────────────────────  Detailed action trail
│  ├─ id (PK)                       │  (user created key, org added member, etc)
│  ├─ action                        │  Searchable by org_id / user_id / action
│  ├─ org_id (FK, nullable)         │  Retention: 1 year (GDPR)
│  ├─ user_id (FK, nullable)        │
│  ├─ api_key_id (FK, nullable)     │
│  ├─ description                   │
│  ├─ changes (JSON)                │
│  └─ created_at                    │
│
│  event_log ────────────────────────  Structured event tracking
│  ├─ id (PK)                       │  (MCP events, perception updates, etc)
│  ├─ event_type                    │  Indexed by timestamp + type
│  ├─ api_key_id (FK, nullable)     │
│  ├─ payload (JSON)                │
│  └─ created_at                    │
│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    MCP & TOKENS                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  mcp_tokens ───────────────────────┐
│  ├─ id (PK)                        │  MCP server authentication
│  ├─ token (UNIQUE)                 │  (issued by backend, validated by
│  ├─ user_id (FK, nullable)         │   tools running in MCP context)
│  ├─ org_id (FK, nullable)          │
│  ├─ api_key_id (FK, nullable)      │
│  ├─ scope (capabilities)           │
│  ├─ created_at                     │
│  ├─ expires_at                     │
│  └─ last_used_at                   │
│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    SETTINGS & CONFIGURATION                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  server_settings ──────────────────┐
│  ├─ key (PK)                       │  Deployment-wide KV settings
│  ├─ value                          │  Hot-reloadable via Admin UI
│  ├─ type (string/int/bool/json)   │  Examples: SESSION_TTL, JWT_SECRET, etc
│  ├─ updated_at                     │
│  └─ updated_by (FK, nullable)      │
│
│  session_stats ────────────────────┤  Per-project session metrics
│  ├─ id (PK)                        │  (tracked for analytics)
│  ├─ api_key_id (FK)                │
│  ├─ session_id (from runtime)      │
│  ├─ duration_ms                    │
│  ├─ caption_count                  │
│  ├─ error_count                    │
│  └─ ended_at                       │
│
│  translation_config ────────────────  Per-project i18n config
│  ├─ id (PK)                         │
│  ├─ api_key_id (FK)                 │
│  ├─ source_lang                     │
│  ├─ target_langs (JSON)             │
│  └─ provider (Google/DeepL/etc)    │
│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                PLUGIN-OWNED TABLES (Partial)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  ┌─ lcyt-dsk ────────────────┐
│  │ ├─ dsk_templates          │  Graphics overlay templates
│  │ ├─ dsk_jobs               │  Rendering jobs
│  │ └─ dsk_* (render state)   │
│  └────────────────────────────┘
│
│  ┌─ lcyt-files ──────────────┐
│  │ ├─ file_storage_config    │  File backend configuration
│  │ ├─ files                  │  Caption file references
│  │ └─ file_* (per-backend)   │
│  └────────────────────────────┘
│
│  ┌─ lcyt-cues ───────────────┐
│  │ ├─ cue_patterns           │  Cue definitions
│  │ ├─ cue_matches            │  Matched cues (event records)
│  │ └─ cue_* (config)         │
│  └────────────────────────────┘
│
│  ┌─ lcyt-rtmp ───────────────┐
│  │ ├─ (see hls_*, preview_*, radio_* above)
│  │ └─ additional RTMP state  │
│  └────────────────────────────┘
│
│  ┌─ lcyt-production ─────────┐
│  │ ├─ device_roles           │  Camera / mixer roles
│  │ ├─ device_* (state)       │
│  │ └─ production_* (config)  │
│  └────────────────────────────┘
│
└─────────────────────────────────────────────────────────────────────────────┘
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
