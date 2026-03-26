/**
 * SttPanel — server-side speech-to-text configuration.
 *
 * Props:
 *   config: { provider, language, audioSource, confidenceThreshold }
 *   onChange: (config) => void
 */
const PROVIDERS = [
  { value: 'google',       label: 'Google Cloud Speech-to-Text' },
  { value: 'whisper_http', label: 'Whisper (HTTP)' },
  { value: 'openai',       label: 'OpenAI Whisper' },
];

const AUDIO_SOURCES = [
  { value: 'hls',  label: 'HLS (MediaMTX)' },
  { value: 'rtmp', label: 'RTMP (via ffmpeg)' },
  { value: 'whep', label: 'WHEP (WebRTC)' },
];

export function SttPanel({ config = {}, onChange }) {
  const {
    provider = 'google',
    language = 'en-US',
    audioSource = 'hls',
    confidenceThreshold = 0,
  } = config;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="settings-field__label">STT provider</label>
        <select
          className="settings-field__input"
          value={provider}
          onChange={e => onChange({ ...config, provider: e.target.value })}
          style={{ width: '100%' }}
        >
          {PROVIDERS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="settings-field__label">Language (BCP-47)</label>
        <input
          className="settings-field__input"
          type="text"
          placeholder="en-US"
          value={language}
          onChange={e => onChange({ ...config, language: e.target.value })}
          style={{ width: '100%' }}
        />
      </div>

      <div>
        <label className="settings-field__label">Audio source</label>
        <select
          className="settings-field__input"
          value={audioSource}
          onChange={e => onChange({ ...config, audioSource: e.target.value })}
          style={{ width: '100%' }}
        >
          {AUDIO_SOURCES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="settings-field__label">
          Confidence threshold: {(confidenceThreshold * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={confidenceThreshold}
          onChange={e => onChange({ ...config, confidenceThreshold: parseFloat(e.target.value) })}
          style={{ width: '100%' }}
        />
        <p className="settings-field__hint" style={{ marginTop: 4 }}>
          Transcripts below this confidence score are silently discarded.
          Set to 0 to accept all transcripts.
        </p>
      </div>
    </div>
  );
}
