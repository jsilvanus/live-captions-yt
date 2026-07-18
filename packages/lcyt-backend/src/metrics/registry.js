/**
 * Single source of truth for the metric catalog (plan_metering_audit §3.2).
 * Every metric written to `usage_rollups` or exposed to Prometheus is listed
 * here; `kind` drives both the buffer merge and the UPSERT/compaction
 * semantics, `unit` is documentation for the REST/UI layer.
 */
export const METRIC_CATALOG = [
  { name: 'captions.sent', kind: 'counter', unit: 'captions' },
  { name: 'captions.failed', kind: 'counter', unit: 'captions' },
  { name: 'sessions.count', kind: 'counter', unit: 'sessions' },
  { name: 'sessions.seconds', kind: 'counter', unit: 'seconds' },
  { name: 'sessions.peak_concurrent', kind: 'max', unit: 'sessions' },
  { name: 'rtmp.streams', kind: 'counter', unit: 'streams' },
  { name: 'rtmp.stream_seconds', kind: 'counter', unit: 'seconds' },
  { name: 'ffmpeg.process_seconds.*', kind: 'counter', unit: 'seconds' },
  { name: 'stt.seconds', kind: 'counter', unit: 'seconds' },
  { name: 'dsk.template_activations', kind: 'counter', unit: 'activations' },
  { name: 'dsk.broadcasts', kind: 'counter', unit: 'broadcasts' },
  { name: 'cues.fired', kind: 'counter', unit: 'cues' },
  { name: 'videos.created', kind: 'counter', unit: 'videos' },
  { name: 'videos.bytes', kind: 'counter', unit: 'bytes' },
  { name: 'viewer.views', kind: 'counter', unit: 'views' },
  { name: 'viewer.peak_concurrent', kind: 'max', unit: 'viewers' },
  { name: 'storage.caption_files_bytes', kind: 'gauge', unit: 'bytes' },
  { name: 'storage.images_bytes', kind: 'gauge', unit: 'bytes' },
  { name: 'egress.mediamtx_bytes', kind: 'counter', unit: 'bytes' },
  { name: 'egress.node_hls_bytes', kind: 'counter', unit: 'bytes' },
  { name: 'connectors.refreshes', kind: 'counter', unit: 'refreshes' },
  { name: 'ai.calls', kind: 'counter', unit: 'calls' },
  { name: 'bridge.commands', kind: 'counter', unit: 'commands' },
  { name: 'production.commands', kind: 'counter', unit: 'commands' },
  { name: 'compute.burst_vms_created', kind: 'counter', unit: 'vms' },
  { name: 'compute.burst_vm_seconds', kind: 'counter', unit: 'seconds' },
  { name: 'auth.logins', kind: 'counter', unit: 'logins' },
];

const exact = new Map();
const prefixes = [];
for (const entry of METRIC_CATALOG) {
  if (entry.name.endsWith('.*')) prefixes.push({ prefix: entry.name.slice(0, -1), entry });
  else exact.set(entry.name, entry);
}

/** @returns {{name: string, kind: string, unit: string}|null} */
export function getMetricDefinition(metric) {
  const hit = exact.get(metric);
  if (hit) return hit;
  const prefixed = prefixes.find(p => metric.startsWith(p.prefix));
  return prefixed ? prefixed.entry : null;
}

/** @returns {'counter'|'gauge'|'max'} defaults to 'counter' for unlisted metrics */
export function kindForMetric(metric) {
  return getMetricDefinition(metric)?.kind || 'counter';
}
