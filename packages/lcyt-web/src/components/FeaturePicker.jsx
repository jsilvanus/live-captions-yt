/**
 * FeaturePicker — grouped feature toggle grid.
 *
 * Props:
 *   value        {Set<string>}    currently enabled feature codes
 *   onChange     {(Set<string>) => void}
 *   allowed      {Set<string>}    which codes the user is entitled to enable
 *                                  (all codes allowed if omitted)
 *   readOnly     {boolean}
 */

const FEATURE_GROUPS = [
  {
    label: 'Core',
    features: [
      { code: 'captions',      label: 'Captions',            desc: 'Send captions to YouTube and other targets' },
      { code: 'viewer-target', label: 'Viewer target',       desc: 'Public caption viewer screen (no auth)' },
      { code: 'mic-lock',      label: 'Mic lock',            desc: 'Collaborative soft mic for multi-operator sessions' },
      { code: 'stats',         label: 'Stats',               desc: 'Usage history and analytics' },
      { code: 'collaboration', label: 'Collaboration',       desc: 'Multi-operator concurrent captioning' },
    ],
  },
  {
    label: 'Content',
    features: [
      { code: 'file-saving',   label: 'Caption file saving', desc: 'Save captions to files for later download' },
      { code: 'translations',  label: 'Translations',        desc: 'Multilingual caption delivery' },
      { code: 'planning',      label: 'Planning',            desc: 'Scripting and rundown (coming soon)', comingSoon: true },
    ],
  },
  {
    label: 'Storage',
    features: [
      { code: 'files-local',          label: 'Local storage',         desc: 'Store caption files on the server\'s local filesystem (default)' },
      { code: 'files-managed-bucket', label: 'Managed S3 storage',    desc: 'Store caption files in the operator-configured S3 bucket' },
      { code: 'files-custom-bucket',  label: 'Custom S3 bucket',      desc: 'Store caption files in a user-supplied S3 bucket (configurable via Files → Storage)' },
    ],
  },
  {
    label: 'Graphics',
    features: [
      { code: 'graphics-client', label: 'Graphics viewer',  desc: 'DSK overlay viewer page (public)' },
      { code: 'graphics-server', label: 'Graphics server',  desc: 'DSK template editor, renderer, and image upload' },
    ],
  },
  {
    label: 'Streaming',
    features: [
      { code: 'ingest',          label: 'RTMP ingest/relay', desc: 'RTMP relay slots and stream management' },
      { code: 'radio',           label: 'Radio/audio HLS',   desc: 'Audio-only HLS stream output' },
      { code: 'hls-stream',      label: 'HLS video stream',  desc: 'Video + audio HLS stream output' },
      { code: 'preview',         label: 'Preview thumbnail', desc: 'Live JPEG thumbnail from RTMP ingest' },
      { code: 'restream-fanout', label: 'Restream fanout',   desc: 'Generic HTTP POST targets alongside YouTube' },
      { code: 'cea-captions',    label: 'CEA-608/708',       desc: 'Broadcast-standard caption encoding' },
    ],
  },
  {
    label: 'Intelligence',
    features: [
      { code: 'stt-server', label: 'Server-side STT', desc: 'Automatic speech-to-text on the server' },
    ],
  },
  {
    label: 'Production',
    features: [
      { code: 'device-control', label: 'Device control', desc: 'Cameras, mixers, and bridge instances' },
    ],
  },
  {
    label: 'Integration',
    features: [
      { code: 'embed', label: 'Embed widgets', desc: 'Embeddable caption and viewer widgets with CORS policy' },
    ],
  },
];

export function FeaturePicker({ value, onChange, allowed, readOnly = false }) {
  const enabled = value instanceof Set ? value : new Set(value || []);

  function toggle(code) {
    if (readOnly) return;
    const next = new Set(enabled);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange?.(next);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {FEATURE_GROUPS.map(group => (
        <div key={group.label}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
            {group.label}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
            {group.features.map(f => {
              const isOn = enabled.has(f.code);
              const isEntitled = !allowed || allowed.has(f.code);
              const isDisabled = readOnly || f.comingSoon || !isEntitled;
              return (
                <button
                  key={f.code}
                  type="button"
                  onClick={() => !isDisabled && toggle(f.code)}
                  title={f.desc}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: `1px solid ${isOn && !isDisabled ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: isOn && !isDisabled ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'var(--color-surface)',
                    cursor: isDisabled ? 'default' : 'pointer',
                    opacity: isDisabled && !isOn ? 0.5 : 1,
                    textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    border: `1.5px solid ${isOn && !isDisabled ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: isOn && !isDisabled ? 'var(--color-primary)' : 'transparent',
                    flexShrink: 0,
                    marginTop: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 10,
                  }}>
                    {isOn && !isDisabled ? '✓' : ''}
                  </span>
                  <span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                      {f.label}
                    </span>
                    {f.comingSoon && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-text-muted)', verticalAlign: 'middle' }}>
                        soon
                      </span>
                    )}
                    {!isEntitled && !isOn && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-text-muted)', verticalAlign: 'middle' }}>
                        not available
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
