/**
 * FeaturePolicyGrid — grouped grid of feature-availability toggles for the
 * Admin Site Features / Team feature-override screens.
 *
 * Backed by the tri-state site-feature-policy model (docs/plans/
 * plan_site_feature_policies.md): most feature codes support 'available' /
 * 'self_service' / 'denied', but a fixed set of "binary-only" codes (ones
 * that require real operator-provisioned infrastructure — RTMP ingest, STT,
 * device control, etc.) only ever meaningfully support 'available'/'denied'.
 *
 * Props:
 *   value          {Record<string, 'available'|'self_service'|'denied'|null>}
 *   onChange       (code, mode) => void
 *   binaryOnly     {Set<string>}   optional — codes that only get a 2-way
 *                                  switch. Falls back to BINARY_ONLY_FALLBACK
 *                                  until the backend's GET /admin/feature-policies
 *                                  response includes this per-code (see
 *                                  BACKEND_PROJECT.md item 6).
 *   allowInherit   {boolean}       when true (per-org override screen), null
 *                                  is a selectable "Default" state alongside
 *                                  the real modes, meaning "no override — use
 *                                  the site-wide policy".
 */

// Fallback classification (plan_site_feature_policies.md's own list) — used
// only until every /admin/feature-policies response includes `binaryOnly`.
const BINARY_ONLY_FALLBACK = new Set([
  'ingest', 'radio', 'hls-stream', 'preview', 'stt-server', 'device-control',
  'graphics-server', 'cea-captions',
]);

const FEATURE_GROUPS = [
  {
    label: 'Core',
    features: [
      { code: 'captions',      label: 'Captions' },
      { code: 'viewer-target', label: 'Viewer target' },
      { code: 'mic-lock',      label: 'Mic lock' },
      { code: 'stats',         label: 'Stats' },
      { code: 'collaboration', label: 'Collaboration' },
    ],
  },
  {
    label: 'Content',
    features: [
      { code: 'file-saving',  label: 'Caption file saving' },
      { code: 'translations', label: 'Translations' },
    ],
  },
  {
    label: 'Storage',
    features: [
      { code: 'files-local',          label: 'Local storage' },
      { code: 'files-managed-bucket', label: 'Managed S3 storage' },
      { code: 'files-custom-bucket',  label: 'Custom S3 bucket' },
      { code: 'files-webdav',         label: 'WebDAV storage' },
      { code: 'files-browser-local',  label: 'Browser local save' },
    ],
  },
  {
    label: 'Graphics',
    features: [
      { code: 'graphics-client', label: 'Graphics viewer' },
      { code: 'graphics-server', label: 'Graphics server' },
    ],
  },
  {
    label: 'Streaming',
    features: [
      { code: 'ingest',       label: 'RTMP ingest/relay' },
      { code: 'radio',        label: 'Radio/audio HLS' },
      { code: 'hls-stream',   label: 'HLS video stream' },
      { code: 'preview',      label: 'Preview thumbnail' },
      { code: 'restream',     label: 'Restream fanout' },
      { code: 'cea-captions', label: 'CEA-608/708' },
    ],
  },
  {
    label: 'Intelligence',
    features: [
      { code: 'stt-server', label: 'Server-side STT' },
    ],
  },
  {
    label: 'Production',
    features: [
      { code: 'device-control', label: 'Device control' },
    ],
  },
  {
    label: 'Integration',
    features: [
      { code: 'embed', label: 'Embed widgets' },
    ],
  },
];

function ModeSwitch({ mode, binary, allowInherit, onChange }) {
  if (binary) {
    const on = mode === 'available';
    return (
      <div
        role="switch"
        aria-checked={on}
        onClick={() => onChange(on ? 'denied' : 'available')}
        title={on ? 'Available' : 'Denied'}
        style={{
          width: 34, height: 20, borderRadius: 10, cursor: 'pointer', flexShrink: 0,
          background: on ? 'var(--color-primary)' : 'var(--color-border)', position: 'relative',
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: on ? 17 : 3, width: 14, height: 14, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left 0.15s',
        }} />
      </div>
    );
  }

  const options = allowInherit
    ? [['available', 'On'], ['self_service', 'Self-serve'], ['denied', 'Off'], [null, 'Default']]
    : [['available', 'On'], ['self_service', 'Self-serve'], ['denied', 'Off']];

  return (
    <div style={{ display: 'inline-flex', border: '1.5px solid var(--color-border)', borderRadius: 7, overflow: 'hidden' }}>
      {options.map(([value, label]) => {
        const active = mode === value;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(value)}
            title={label}
            style={{
              padding: '3px 8px', fontSize: 11, fontWeight: 500, border: 'none', cursor: 'pointer',
              background: active ? 'var(--color-primary)' : 'transparent',
              color: active ? '#fff' : 'var(--color-text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function FeaturePolicyGrid({ value = {}, onChange, binaryOnly, allowInherit = false, groups = FEATURE_GROUPS }) {
  const binarySet = binaryOnly instanceof Set ? binaryOnly : BINARY_ONLY_FALLBACK;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
      {groups.map(group => (
        <div key={group.label} style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '9px 14px', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--color-text-muted)', margin: 0 }}>
              {group.label}
            </p>
          </div>
          <div>
            {group.features.map(feat => (
              <div key={feat.code} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
                padding: '9px 14px', borderBottom: '1px solid var(--color-border)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 500, minWidth: 0, flex: 1 }}>{feat.label}</span>
                <ModeSwitch
                  mode={value[feat.code] ?? null}
                  binary={binarySet.has(feat.code)}
                  allowInherit={allowInherit}
                  onChange={mode => onChange(feat.code, mode)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
