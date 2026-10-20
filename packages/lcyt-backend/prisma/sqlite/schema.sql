-- CreateTable
CREATE TABLE IF NOT EXISTS "action_defs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "definition" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_context" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "context_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TEXT DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "description" TEXT,
    "confidence" REAL DEFAULT 0,
    "context_json" TEXT,
    "created_at" TEXT DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_config" (
    "api_key" TEXT NOT NULL PRIMARY KEY,
    "embedding_provider" TEXT NOT NULL DEFAULT 'none',
    "embedding_model" TEXT NOT NULL DEFAULT '',
    "embedding_api_key" TEXT NOT NULL DEFAULT '',
    "embedding_api_url" TEXT NOT NULL DEFAULT '',
    "fuzzy_threshold" REAL NOT NULL DEFAULT 0.75,
    "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_provider_grants" (
    "api_key" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ai_provider_grants_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_provider_models" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "parameter_size" TEXT,
    "quantization" TEXT,
    "discovered_at" TEXT,
    "last_seen_at" TEXT,
    CONSTRAINT "ai_provider_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "owner_api_key" TEXT,
    "kind" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT 'custom',
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL DEFAULT '',
    "api_key_ref" TEXT NOT NULL DEFAULT '',
    "bridge_instance_id" TEXT,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "last_discovery_at" TEXT,
    "last_discovery_error" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_roles" (
    "role_code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "input_types" TEXT NOT NULL DEFAULT '[]',
    "output_type" TEXT NOT NULL,
    "runtime_kind" TEXT NOT NULL,
    "available_tools" TEXT NOT NULL DEFAULT '[]',
    "is_builtin" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_connectors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "auth_type" TEXT NOT NULL DEFAULT 'none',
    "auth_config" TEXT NOT NULL DEFAULT '{}',
    "headers" TEXT NOT NULL DEFAULT '[]',
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "expires_at" TEXT,
    "active" INTEGER NOT NULL DEFAULT 1,
    "email" TEXT,
    "daily_limit" INTEGER,
    "lifetime_limit" INTEGER,
    "lifetime_used" INTEGER NOT NULL DEFAULT 0,
    "active_broadcast_id" TEXT,
    "revoked_at" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "last_caption_at" TEXT,
    "backend_file_enabled" INTEGER NOT NULL DEFAULT 0,
    "graphics_enabled" INTEGER NOT NULL DEFAULT 0,
    "user_id" INTEGER,
    "org_id" INTEGER,
    "restricted" INTEGER NOT NULL DEFAULT 0,
    "org_baseline_role" TEXT NOT NULL DEFAULT 'viewer',
    "relay_allowed" INTEGER NOT NULL DEFAULT 0,
    "relay_active" INTEGER NOT NULL DEFAULT 0,
    "radio_enabled" INTEGER NOT NULL DEFAULT 0,
    "hls_enabled" INTEGER NOT NULL DEFAULT 0,
    "cea708_delay_ms" INTEGER NOT NULL DEFAULT 0,
    "embed_cors" TEXT NOT NULL DEFAULT '*',
    "device_code" TEXT,
    "ingest_stream_key" TEXT,
    "public_slug" TEXT,
    "primary_feed_id" TEXT,
    CONSTRAINT "api_keys_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connector_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "query_params" TEXT NOT NULL DEFAULT '[]',
    "body_type" TEXT NOT NULL DEFAULT 'raw',
    "body_content" TEXT,
    "response_type" TEXT NOT NULL DEFAULT 'auto',
    "prefetch_interval_ms" INTEGER NOT NULL DEFAULT 3000,
    "timeout_ms" INTEGER NOT NULL DEFAULT 200,
    "constant_poll_enabled" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "api_requests_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "api_connectors" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_response_mappings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "request_id" TEXT NOT NULL,
    "json_path" TEXT NOT NULL DEFAULT '$',
    "variable_name" TEXT NOT NULL,
    "skip_if_null" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "api_response_mappings_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "api_requests" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "actor" TEXT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT,
    "user_id" INTEGER,
    "api_key" TEXT,
    "org_id" INTEGER,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "details" TEXT,
    "ip" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "auth_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT,
    "event_type" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "domain" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bridge_security_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bridge_instance_id" TEXT NOT NULL,
    "rule_kind" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "bridge_security_rules_bridge_instance_id_fkey" FOREIGN KEY ("bridge_instance_id") REFERENCES "prod_bridge_instances" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "broadcast_assets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "broadcast_id" TEXT NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_ref" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "broadcast_assets_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "broadcast_outputs" (
    "broadcast_id" TEXT NOT NULL,
    "output_id" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),

    PRIMARY KEY ("broadcast_id", "output_id"),
    CONSTRAINT "broadcast_outputs_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "broadcast_files" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "broadcast_id" TEXT NOT NULL,
    "file_id" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "broadcast_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "caption_files" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "broadcast_files_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "broadcast_platform_links" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "broadcast_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "credential_id" TEXT,
    "external_broadcast_id" TEXT NOT NULL,
    "external_stream_id" TEXT,
    "external_video_ids" TEXT,
    "thumbnail_url" TEXT,
    "last_status" TEXT,
    "last_synced_at" TEXT,
    "last_sync_error" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "broadcast_platform_links_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "platform_credentials" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "broadcast_platform_links_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "broadcast_platform_stats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "broadcast_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "captured_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "kind" TEXT NOT NULL,
    "concurrent_viewers" INTEGER,
    "views" INTEGER,
    "average_watch_time_s" INTEGER,
    "peak_concurrent_viewers" INTEGER,
    CONSTRAINT "broadcast_platform_stats_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "broadcasts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduled_start" TEXT,
    "scheduled_end" TEXT,
    "actual_start" TEXT,
    "actual_end" TEXT,
    "youtube_video_ids" TEXT,
    "youtube_broadcast_id" TEXT,
    "rundown_file_id" INTEGER,
    "record_enabled" INTEGER NOT NULL DEFAULT 0,
    "privacy_status" TEXT NOT NULL DEFAULT 'unlisted',
    "armed" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "caption_sequence" INTEGER NOT NULL DEFAULT 0,
    "sync_offset_ms" INTEGER,
    "last_synced_at" TEXT,
    "sync_failures" INTEGER NOT NULL DEFAULT 0,
    "stage_report_json" TEXT,
    "adhoc" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "broadcasts_api_key_fkey" FOREIGN KEY ("api_key") REFERENCES "api_keys" ("key") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bus_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" TEXT,
    "topic" TEXT NOT NULL,
    "ts" BIGINT NOT NULL,
    "payload_json" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bus_payloads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" BIGINT NOT NULL,
    "payload" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "caption_errors" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "error_code" INTEGER,
    "error_msg" TEXT,
    "batch_size" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "caption_files" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "session_id" TEXT,
    "filename" TEXT NOT NULL,
    "lang" TEXT,
    "format" TEXT NOT NULL DEFAULT 'youtube',
    "type" TEXT NOT NULL DEFAULT 'captions',
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "broadcast_id" TEXT,
    "shorthand" TEXT,
    "mime_type" TEXT,
    "settings_json" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "caption_targets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "stream_key" TEXT,
    "url" TEXT,
    "headers" TEXT,
    "viewer_key" TEXT,
    "no_batch" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "icon_id" INTEGER,
    "icon_enabled" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "caption_targets_api_key_fkey" FOREIGN KEY ("api_key") REFERENCES "api_keys" ("key") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "caption_usage" (
    "api_key" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("api_key", "date")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "connector_network_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "org_id" INTEGER,
    "rule_type" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "description" TEXT,
    "created_by" INTEGER,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "crop_config" (
    "api_key" TEXT NOT NULL PRIMARY KEY,
    "enabled" INTEGER NOT NULL DEFAULT 0,
    "aspect_w" INTEGER NOT NULL DEFAULT 9,
    "aspect_h" INTEGER NOT NULL DEFAULT 16,
    "out_w" INTEGER,
    "out_h" INTEGER,
    "video_bitrate" TEXT,
    "follow_program" INTEGER NOT NULL DEFAULT 1,
    "transition_ms" INTEGER NOT NULL DEFAULT 0,
    "active_set_id" TEXT,
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "auto_follow" INTEGER NOT NULL DEFAULT 0,
    "output_id" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "crop_preset_sets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "output_id" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "crop_presets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "set_id" TEXT,
    "name" TEXT NOT NULL,
    "x_norm" REAL NOT NULL DEFAULT 0.5,
    "y_norm" REAL NOT NULL DEFAULT 0.0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "output_id" TEXT,
    CONSTRAINT "crop_presets_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "crop_preset_sets" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "crop_source_map" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "mixer_id" TEXT,
    "mixer_input" INTEGER,
    "camera_id" TEXT,
    "camera_preset" TEXT,
    "preset_id" TEXT NOT NULL,
    "output_id" TEXT,
    CONSTRAINT "crop_source_map_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "crop_presets" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cue_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "rule_name" TEXT NOT NULL,
    "matched" TEXT,
    "action" TEXT NOT NULL DEFAULT '{}',
    "ts" INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cue_named_conditions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "condition_tree" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'api',
    "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cue_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "match_type" TEXT NOT NULL DEFAULT 'phrase',
    "pattern" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT '{}',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "cooldown_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "fuzzy_threshold" REAL NOT NULL DEFAULT 0.75,
    "condition_tree" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "domain_hourly_stats" (
    "date" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "sessions_started" INTEGER NOT NULL DEFAULT 0,
    "sessions_ended" INTEGER NOT NULL DEFAULT 0,
    "captions_sent" INTEGER NOT NULL DEFAULT 0,
    "captions_failed" INTEGER NOT NULL DEFAULT 0,
    "batches_sent" INTEGER NOT NULL DEFAULT 0,
    "total_duration_ms" BIGINT NOT NULL DEFAULT 0,
    "peak_sessions" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("date", "hour", "domain")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dsk_templates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template_json" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dsk_thumbnails" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "template_id" INTEGER,
    "name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dsk_viewports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "viewport_type" TEXT NOT NULL DEFAULT 'landscape',
    "width" INTEGER NOT NULL DEFAULT 1920,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "text_layers_json" TEXT,
    "display_settings_json" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "icons" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "disk_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'image/png',
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "size_bytes" BIGINT NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "instances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostname" TEXT NOT NULL,
    "url" TEXT,
    "started_at" BIGINT NOT NULL,
    "heartbeat_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "key_storage_config" (
    "api_key" TEXT NOT NULL PRIMARY KEY,
    "storage_type" TEXT NOT NULL DEFAULT 's3',
    "bucket" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT 'auto',
    "endpoint" TEXT,
    "prefix" TEXT NOT NULL DEFAULT 'captions',
    "access_key_id" TEXT,
    "secret_access_key" TEXT,
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "leases" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "mcp_tokens" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" INTEGER,
    "project_id" TEXT,
    "scopes" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "last_used_at" TEXT,
    "revoked_at" TEXT,
    "active" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" INTEGER,
    "created_by_name" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "music_config" (
    "api_key" TEXT NOT NULL PRIMARY KEY,
    "enabled" INTEGER NOT NULL DEFAULT 0,
    "silence_threshold" REAL NOT NULL DEFAULT 0.01,
    "flatness_threshold" REAL NOT NULL DEFAULT 0.4,
    "zcr_threshold" REAL NOT NULL DEFAULT 0.15,
    "confirm_segments" INTEGER NOT NULL DEFAULT 2,
    "bpm_enabled" INTEGER NOT NULL DEFAULT 1,
    "bpm_min" INTEGER NOT NULL DEFAULT 40,
    "bpm_max" INTEGER NOT NULL DEFAULT 200,
    "auto_start" INTEGER NOT NULL DEFAULT 0,
    "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    "auto_calibrate" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "music_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "label" TEXT,
    "bpm" REAL,
    "confidence" REAL,
    "ts" INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "org_feature_overrides" (
    "org_id" INTEGER NOT NULL,
    "feature_code" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "set_by" INTEGER,
    "set_at" TEXT NOT NULL DEFAULT (datetime('now')),

    PRIMARY KEY ("org_id", "feature_code"),
    CONSTRAINT "org_feature_overrides_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "org_feature_overrides_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "org_members" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "org_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "invited_by" INTEGER,
    "joined_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "org_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "organizations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "project_slug_policy" TEXT NOT NULL DEFAULT 'none',
    CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "platform_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "account_label" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "expires_at" TEXT NOT NULL,
    "scopes" TEXT,
    "connected_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "revoked_at" TEXT,
    CONSTRAINT "platform_credentials_api_key_fkey" FOREIGN KEY ("api_key") REFERENCES "api_keys" ("key") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prod_bridge_instances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "last_seen" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prod_camera_preset_thumbnails" (
    "camera_id" TEXT NOT NULL,
    "preset_id" TEXT NOT NULL,
    "captured_at" TEXT NOT NULL,

    PRIMARY KEY ("camera_id", "preset_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prod_cameras" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mixer_input" INTEGER,
    "control_type" TEXT NOT NULL DEFAULT 'none',
    "control_config" TEXT NOT NULL DEFAULT '{}',
    "bridge_instance_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "connection_source" TEXT NOT NULL DEFAULT 'backend',
    "thumbnail_captured_at" TEXT,
    "perception_enabled" INTEGER NOT NULL DEFAULT 0,
    "owner_api_key" TEXT,
    "label" TEXT,
    "zone" TEXT,
    "overlap_links" TEXT NOT NULL DEFAULT '[]',
    "mixer_id" TEXT,
    CONSTRAINT "prod_cameras_mixer_id_fkey" FOREIGN KEY ("mixer_id") REFERENCES "prod_mixers" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "prod_cameras_bridge_instance_id_fkey" FOREIGN KEY ("bridge_instance_id") REFERENCES "prod_bridge_instances" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prod_encoders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "connection_config" TEXT NOT NULL DEFAULT '{}',
    "connection_source" TEXT NOT NULL DEFAULT 'backend',
    "bridge_instance_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "prod_encoders_bridge_instance_id_fkey" FOREIGN KEY ("bridge_instance_id") REFERENCES "prod_bridge_instances" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prod_mixers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "connection_config" TEXT NOT NULL DEFAULT '{}',
    "bridge_instance_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "connection_source" TEXT NOT NULL DEFAULT 'backend',
    "output_key" TEXT,
    "owner_api_key" TEXT,
    CONSTRAINT "prod_mixers_bridge_instance_id_fkey" FOREIGN KEY ("bridge_instance_id") REFERENCES "prod_bridge_instances" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prod_perception_jobs" (
    "job_key" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "started_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prod_perception_settings" (
    "api_key" TEXT NOT NULL PRIMARY KEY,
    "shared_enabled" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_ai_role_configs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "role_code" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 0,
    "provider_id" TEXT,
    "model_name" TEXT NOT NULL DEFAULT '',
    "harness_config" TEXT NOT NULL DEFAULT '{}',
    "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    CONSTRAINT "project_ai_role_configs_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "ai_roles" ("role_code") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_device_roles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "role_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "config" TEXT,
    "active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "expires_at" TEXT,
    CONSTRAINT "project_device_roles_api_key_fkey" FOREIGN KEY ("api_key") REFERENCES "api_keys" ("key") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_features" (
    "api_key" TEXT NOT NULL,
    "feature_code" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "config" TEXT,
    "granted_by" INTEGER,
    "granted_at" TEXT NOT NULL DEFAULT (datetime('now')),

    PRIMARY KEY ("api_key", "feature_code"),
    CONSTRAINT "project_features_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "project_features_api_key_fkey" FOREIGN KEY ("api_key") REFERENCES "api_keys" ("key") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_member_permissions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "member_id" INTEGER NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "project_member_permissions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "project_members" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_members" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "access_level" TEXT NOT NULL DEFAULT 'editor',
    "invited_by" INTEGER,
    "joined_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "project_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "project_members_api_key_fkey" FOREIGN KEY ("api_key") REFERENCES "api_keys" ("key") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "radio_config" (
    "api_key" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "description" TEXT,
    "cover_image_url" TEXT,
    "autoplay" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rtmp_anon_daily_stats" (
    "date" TEXT NOT NULL,
    "endpoint_type" TEXT NOT NULL,
    "caption_mode" TEXT NOT NULL DEFAULT 'http',
    "streams_count" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("date", "endpoint_type", "caption_mode")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rtmp_relays" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 1,
    "target_url" TEXT NOT NULL,
    "target_name" TEXT,
    "caption_mode" TEXT NOT NULL DEFAULT 'http',
    "record_on_start" INTEGER NOT NULL DEFAULT 0,
    "record_on_button" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "scale" TEXT,
    "fps" INTEGER,
    "video_bitrate" TEXT,
    "audio_bitrate" TEXT,
    "source_view" TEXT NOT NULL DEFAULT 'program',
    "source_feed_id" TEXT,
    "source_output_id" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rtmp_stream_stats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 1,
    "target_url" TEXT NOT NULL,
    "target_name" TEXT,
    "caption_mode" TEXT NOT NULL DEFAULT 'http',
    "started_at" TEXT NOT NULL,
    "ended_at" TEXT,
    "duration_ms" BIGINT NOT NULL DEFAULT 0,
    "captions_sent" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "server_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_by" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "session_stats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "domain" TEXT,
    "started_at" TEXT NOT NULL,
    "ended_at" TEXT NOT NULL,
    "duration_ms" BIGINT NOT NULL,
    "captions_sent" INTEGER NOT NULL DEFAULT 0,
    "captions_failed" INTEGER NOT NULL DEFAULT 0,
    "final_sequence" INTEGER NOT NULL DEFAULT 0,
    "ended_by" TEXT NOT NULL DEFAULT 'client',
    "broadcast_id" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sessions" (
    "session_id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT,
    "stream_key" TEXT,
    "domain" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "started_at" TEXT,
    "last_activity" TEXT,
    "sync_offset" INTEGER,
    "mic_holder" TEXT,
    "data" TEXT,
    "broadcast_id" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "site_feature_policies" (
    "feature_code" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'denied',
    "updated_by" INTEGER,
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "site_feature_policies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "stt_config" (
    "api_key" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "language" TEXT NOT NULL DEFAULT 'en-US',
    "audio_source" TEXT NOT NULL DEFAULT 'hls',
    "stream_key" TEXT,
    "auto_start" INTEGER NOT NULL DEFAULT 0,
    "confidence_threshold" REAL,
    "created_at" INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    "feed_id" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "stt_source_languages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "api_key" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "label" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "translation_targets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "lang" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "format" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "caption_target_id" TEXT,
    "show_original" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "translation_targets_caption_target_id_fkey" FOREIGN KEY ("caption_target_id") REFERENCES "caption_targets" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "translation_targets_api_key_fkey" FOREIGN KEY ("api_key") REFERENCES "api_keys" ("key") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "translation_vendor_config" (
    "api_key" TEXT NOT NULL PRIMARY KEY,
    "vendor" TEXT NOT NULL DEFAULT 'mymemory',
    "vendor_api_key" TEXT,
    "libre_url" TEXT,
    "libre_key" TEXT,
    "show_original" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "translation_vendor_config_api_key_fkey" FOREIGN KEY ("api_key") REFERENCES "api_keys" ("key") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "usage_rollups" (
    "api_key" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "grain" TEXT NOT NULL DEFAULT 'hour',
    "metric" TEXT NOT NULL,
    "value" REAL NOT NULL DEFAULT 0,

    PRIMARY KEY ("api_key", "metric", "grain", "period_start")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_features" (
    "user_id" INTEGER NOT NULL,
    "feature_code" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "config" TEXT,
    "granted_by" INTEGER,
    "granted_at" TEXT NOT NULL DEFAULT (datetime('now')),

    PRIMARY KEY ("user_id", "feature_code"),
    CONSTRAINT "user_features_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "user_features_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "active" INTEGER NOT NULL DEFAULT 1,
    "is_admin" INTEGER NOT NULL DEFAULT 0,
    "admin_role" TEXT NOT NULL DEFAULT 'full'
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "variables" (
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "current_value" TEXT,
    "default_value" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_request_id" TEXT,
    "resolved_at" TEXT,
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "expires_at" TEXT,
    "expires_at_seq" INTEGER,
    "revert_mode" TEXT,
    "revert_value" TEXT,
    "prev_value" TEXT,

    PRIMARY KEY ("api_key", "name"),
    CONSTRAINT "variables_source_request_id_fkey" FOREIGN KEY ("source_request_id") REFERENCES "api_requests" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "videos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "broadcast_id" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'recording',
    "storage_type" TEXT NOT NULL DEFAULT 'local',
    "storage_key" TEXT,
    "duration_ms" BIGINT,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "started_at" TEXT,
    "ended_at" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT "videos_api_key_fkey" FOREIGN KEY ("api_key") REFERENCES "api_keys" ("key") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "video_feeds" (
    "video_id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "meta_json" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "handoffs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "broadcast_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "manifest_json" TEXT,
    "error" TEXT,
    "sent_at" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tally_lights" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "runner" TEXT NOT NULL DEFAULT 'auto',
    "bridge_instance_id" TEXT,
    "source_json" TEXT NOT NULL,
    "output_json" TEXT NOT NULL,
    "look_json" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prod_feeds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feed_key" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'rtmp',
    "kind" TEXT NOT NULL DEFAULT 'generic',
    "label" TEXT,
    "device_type" TEXT,
    "device_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "media" TEXT NOT NULL DEFAULT 'av'
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "viewer_anon_daily_stats" (
    "date" TEXT NOT NULL PRIMARY KEY,
    "views" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "viewer_key_daily_stats" (
    "date" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "viewer_key" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("date", "api_key", "viewer_key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notify_contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "sms_number" TEXT,
    "consent_email" INTEGER NOT NULL DEFAULT 0,
    "consent_sms" INTEGER NOT NULL DEFAULT 0,
    "active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notify_providers" (
    "api_key" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "config_json" TEXT NOT NULL,
    "secrets_enc" TEXT,
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notify_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "contact_slug" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_id" TEXT,
    "error" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "outputs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'feed',
    "source_id" TEXT,
    "dsk_json" TEXT NOT NULL DEFAULT '[]',
    "crop_enabled" INTEGER NOT NULL DEFAULT 0,
    "audio_source" TEXT NOT NULL DEFAULT '"source"',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "output_crop_config" (
    "output_id" TEXT NOT NULL PRIMARY KEY,
    "enabled" INTEGER NOT NULL DEFAULT 0,
    "aspect_w" INTEGER NOT NULL DEFAULT 9,
    "aspect_h" INTEGER NOT NULL DEFAULT 16,
    "out_w" INTEGER,
    "out_h" INTEGER,
    "video_bitrate" TEXT,
    "follow_program" INTEGER NOT NULL DEFAULT 1,
    "transition_ms" INTEGER NOT NULL DEFAULT 0,
    "active_set_id" TEXT,
    "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
    "auto_follow" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_action_defs_key" ON "action_defs"("api_key");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_action_defs_2" ON "action_defs"("api_key", "slug");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_agent_context_api_key" ON "agent_context"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_agent_events_api_key" ON "agent_events"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ai_provider_grants_key" ON "ai_provider_grants"("api_key");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_provider_grants_1" ON "ai_provider_grants"("api_key", "provider_id");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ai_provider_models_provider" ON "ai_provider_models"("provider_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_provider_models_1" ON "ai_provider_models"("provider_id", "model_name");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ai_providers_owner" ON "ai_providers"("owner_api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_api_connectors_key" ON "api_connectors"("api_key");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_api_connectors_2" ON "api_connectors"("api_key", "slug");
Pragma writable_schema=0;

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_api_keys_1" ON "api_keys"("key");
Pragma writable_schema=0;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_api_keys_ingest_stream_key" ON "api_keys"("ingest_stream_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_api_keys_public_slug" ON "api_keys"("public_slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_api_keys_org" ON "api_keys"("org_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_api_requests_connector" ON "api_requests"("connector_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_api_requests_2" ON "api_requests"("connector_id", "slug");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_api_response_mappings_request" ON "api_response_mappings"("request_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_audit_log_action" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_audit_log_org" ON "audit_log"("org_id", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_audit_log_project" ON "audit_log"("api_key", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_audit_log_created" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_bridge_security_rules_instance" ON "bridge_security_rules"("bridge_instance_id", "rule_kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_broadcast_assets_bid" ON "broadcast_assets"("broadcast_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_broadcast_assets_1" ON "broadcast_assets"("broadcast_id", "asset_type", "asset_ref");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_broadcast_outputs_output" ON "broadcast_outputs"("output_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_broadcast_files_fid" ON "broadcast_files"("file_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_broadcast_files_bid" ON "broadcast_files"("broadcast_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_broadcast_files_1" ON "broadcast_files"("broadcast_id", "file_id");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_bpl_status" ON "broadcast_platform_links"("last_status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_bpl_broadcast" ON "broadcast_platform_links"("broadcast_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_broadcast_platform_links_1" ON "broadcast_platform_links"("broadcast_id", "platform");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_bps_broadcast" ON "broadcast_platform_stats"("broadcast_id", "kind", "captured_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_broadcasts_status" ON "broadcasts"("api_key", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_broadcasts_api_key" ON "broadcasts"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_bus_events_ts" ON "bus_events"("ts");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_bus_events_project" ON "bus_events"("project_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_bus_payloads_created" ON "bus_payloads"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_caption_targets_api_key" ON "caption_targets"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_connector_network_rules_scope" ON "connector_network_rules"("scope", "org_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_crop_preset_sets_2" ON "crop_preset_sets"("api_key", "name");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_crop_presets_key" ON "crop_presets"("api_key", "set_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_crop_presets_2" ON "crop_presets"("api_key", "set_id", "name");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_crop_source_map_key" ON "crop_source_map"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cue_events_key_ts" ON "cue_events"("api_key", "ts");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "cue_named_conditions_key_name" ON "cue_named_conditions"("api_key", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cue_rules_key" ON "cue_rules"("api_key");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dsk_templates_1" ON "dsk_templates"("api_key", "name");
Pragma writable_schema=0;

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dsk_viewports_1" ON "dsk_viewports"("api_key", "name");
Pragma writable_schema=0;

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_mcp_tokens_1" ON "mcp_tokens"("token_hash");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_mcp_tokens_key" ON "mcp_tokens"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "music_events_key_ts" ON "music_events"("api_key", "ts");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_org_feature_overrides_org" ON "org_feature_overrides"("org_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_org_members_org" ON "org_members"("org_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_org_members_user" ON "org_members"("user_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_org_members_1" ON "org_members"("org_id", "user_id");
Pragma writable_schema=0;

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_organizations_1" ON "organizations"("slug");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_platform_credentials_key" ON "platform_credentials"("api_key");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_credentials_2" ON "platform_credentials"("api_key", "platform", "external_account_id");
Pragma writable_schema=0;

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_prod_bridge_instances_2" ON "prod_bridge_instances"("token");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_project_ai_role_configs_key" ON "project_ai_role_configs"("api_key");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_ai_role_configs_1" ON "project_ai_role_configs"("api_key", "role_code");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_device_roles_key" ON "project_device_roles"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_project_features_key" ON "project_features"("api_key");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_member_permissions_1" ON "project_member_permissions"("member_id", "permission");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_project_members_key" ON "project_members"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_project_members_user" ON "project_members"("user_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_members_1" ON "project_members"("api_key", "user_id");
Pragma writable_schema=0;

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_rtmp_relays_1" ON "rtmp_relays"("api_key", "slot");
Pragma writable_schema=0;

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_stt_source_languages_1" ON "stt_source_languages"("api_key", "lang");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_translation_targets_api_key" ON "translation_targets"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_usage_rollups_metric" ON "usage_rollups"("metric", "period_start");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_usage_rollups_period" ON "usage_rollups"("period_start");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_user_features_user" ON "user_features"("user_id");

-- CreateIndex
Pragma writable_schema=1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_1" ON "users"("email");
Pragma writable_schema=0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_videos_broadcast_id" ON "videos"("broadcast_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_videos_api_key" ON "videos"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_video_feeds_group" ON "video_feeds"("group_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_video_feeds_api_key" ON "video_feeds"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_handoffs_api_key" ON "handoffs"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_handoffs_broadcast_id" ON "handoffs"("broadcast_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_tally_lights_api_key" ON "tally_lights"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prod_feeds_feed_key" ON "prod_feeds"("feed_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_prod_feeds_owner" ON "prod_feeds"("owner_api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_prod_feeds_device" ON "prod_feeds"("device_type", "device_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_notify_contacts_key" ON "notify_contacts"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_notify_contacts_slug" ON "notify_contacts"("api_key", "slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_notify_log_key_at" ON "notify_log"("api_key", "at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_outputs_owner" ON "outputs"("owner_api_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_outputs_owner_name" ON "outputs"("owner_api_key", "name");

