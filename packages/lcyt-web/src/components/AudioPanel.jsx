import { useState, useEffect, useRef } from 'react';

const STORAGE_KEY_DEVICE   = 'lcyt-audio-device';
const STORAGE_KEY_STT_LANG = 'lcyt-stt-lang';
const STORAGE_KEY_STT_CFG  = 'lcyt-stt-config';

const STT_MODELS = [
  { value: 'latest_long',       label: 'Latest Long' },
  { value: 'latest_short',      label: 'Latest Short' },
  { value: 'telephony',         label: 'Telephony' },
  { value: 'video',             label: 'Video' },
  { value: 'medical_dictation', label: 'Medical Dictation' },
];

const COMMON_LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ru-RU', label: 'Russian' },
  { code: 'nl-NL', label: 'Dutch' },
  { code: 'pl-PL', label: 'Polish' },
  { code: 'sv-SE', label: 'Swedish' },
  { code: 'da-DK', label: 'Danish' },
  { code: 'fi-FI', label: 'Finnish' },
  { code: 'nb-NO', label: 'Norwegian' },
  { code: 'tr-TR', label: 'Turkish' },
  { code: 'id-ID', label: 'Indonesian' },
  { code: 'th-TH', label: 'Thai' },
  { code: 'vi-VN', label: 'Vietnamese' },
  { code: 'uk-UA', label: 'Ukrainian' },
  { code: 'cs-CZ', label: 'Czech' },
  { code: 'ro-RO', label: 'Romanian' },
  { code: 'hu-HU', label: 'Hungarian' },
];

function loadSttConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STT_CFG) || '{}'); }
  catch { return {}; }
}

function saveSttConfig(patch) {
  const cfg = loadSttConfig();
  try { localStorage.setItem(STORAGE_KEY_STT_CFG, JSON.stringify({ ...cfg, ...patch })); } catch {}
}

export function AudioPanel({ visible }) {
  const cfg = loadSttConfig();
  const savedLang = localStorage.getItem(STORAGE_KEY_STT_LANG) || 'en-US';
  const savedLangEntry = COMMON_LANGUAGES.find(l => l.code === savedLang);

  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(localStorage.getItem(STORAGE_KEY_DEVICE) || '');
  const [permStatus, setPermStatus] = useState('unknown');
  const [listening, setListening] = useState(false);
  const [langQuery, setLangQuery] = useState(savedLangEntry ? savedLangEntry.label : savedLang);
  const [langCode, setLangCode] = useState(savedLang);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [model, setModel] = useState(cfg.model || 'latest_long');
  const [punctuation, setPunctuation] = useState(cfg.punctuation !== undefined ? cfg.punctuation : true);
  const [profanity, setProfanity] = useState(cfg.profanity || false);
  const [autosend, setAutosend] = useState(cfg.autosend || false);
  const [confidence, setConfidence] = useState(cfg.confidence !== undefined ? cfg.confidence : 0.70);
  const [maxLen, setMaxLen] = useState(cfg.maxLen || 80);

  const meterCanvasRef = useRef(null);

  useEffect(() => {
    drawMeterIdle();
    checkPermission();
    enumerateDevices();

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
      return () => navigator.mediaDevices.removeEventListener('devicechange', enumerateDevices);
    }
  }, []);

  function drawMeterIdle() {
    const canvas = meterCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'var(--color-surface-elevated, #2a2a2a)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'var(--color-border, #444)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Audio level — active when listening', canvas.width / 2, canvas.height / 2);
  }

  async function enumerateDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) { return; }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter(d => d.kind === 'audioinput');
      setDevices(inputs);
    } catch {}
  }

  async function checkPermission() {
    if (!navigator.permissions) return;
    try {
      const result = await navigator.permissions.query({ name: 'microphone' });
      setPermStatus(result.state);
      result.addEventListener('change', () => setPermStatus(result.state));
    } catch {}
  }

  async function requestPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setPermStatus('granted');
      await enumerateDevices();
    } catch {
      setPermStatus('denied');
    }
  }

  function onDeviceChange(deviceId) {
    setSelectedDevice(deviceId);
    try { localStorage.setItem(STORAGE_KEY_DEVICE, deviceId); } catch {}
  }

  function onStartListening() {
    window.dispatchEvent(new CustomEvent('lcyt:audio-start', { detail: { deviceId: selectedDevice } }));
    setListening(true);
  }

  function onStopListening() {
    window.dispatchEvent(new CustomEvent('lcyt:audio-stop'));
    setListening(false);
    drawMeterIdle();
  }

  function onLangInput(value) {
    setLangQuery(value);
    setLangDropdownOpen(value.trim().length > 0);
  }

  function selectLang(entry) {
    setLangQuery(entry.label);
    setLangCode(entry.code);
    setLangDropdownOpen(false);
    try { localStorage.setItem(STORAGE_KEY_STT_LANG, entry.code); } catch {}
  }

  const langMatches = langDropdownOpen
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(langQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(langQuery.toLowerCase())
      )
    : [];

  if (!visible) return null;

  return (
    <div className="audio-panel">
      <div className="audio-panel__scroll">

        <section className="audio-section">
          <h3 className="audio-section__title">Audio Source</h3>

          <div className="audio-field">
            <label className="audio-field__label">Microphone</label>
            <div className="audio-field__row">
              <select
                className="audio-field__select"
                value={selectedDevice}
                onChange={e => onDeviceChange(e.target.value)}
              >
                <option value="">— select a device —</option>
                {devices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`}
                  </option>
                ))}
              </select>
              <button className="btn btn--secondary btn--sm" onClick={enumerateDevices} title="Refresh device list">&#8635;</button>
            </div>
          </div>

          <div className="audio-field">
            <label className="audio-field__label">Microphone Permission</label>
            <div className="audio-field__row">
              <span className={`audio-perm-status audio-perm-status--${permStatus}`}>
                {permStatus.charAt(0).toUpperCase() + permStatus.slice(1)}
              </span>
              <button className="btn btn--secondary btn--sm" onClick={requestPermission}>Request Permission</button>
            </div>
          </div>

          <div className="audio-field">
            <label className="audio-field__label">Audio Level</label>
            <canvas
              ref={meterCanvasRef}
              className="audio-meter"
              width={300}
              height={20}
              title="Audio level meter (active when listening)"
            />
          </div>

          <div className="audio-field audio-field--actions">
            {!listening ? (
              <button
                className="btn btn--primary"
                disabled={!selectedDevice}
                onClick={onStartListening}
              >&#9654; Start Listening</button>
            ) : (
              <button className="btn btn--secondary" onClick={onStopListening}>&#9632; Stop Listening</button>
            )}
            {listening && (
              <span className="audio-listen-status audio-listen-status--active">Listening…</span>
            )}
          </div>
        </section>

        <section className="audio-section">
          <h3 className="audio-section__title">Speech Recognition (STT)</h3>

          <div className="audio-field">
            <label className="audio-field__label">Language</label>
            <div className="audio-lang-wrap">
              <input
                className="audio-field__input"
                type="text"
                placeholder="Type to filter…"
                autoComplete="off"
                spellCheck={false}
                value={langQuery}
                onChange={e => onLangInput(e.target.value)}
                onBlur={() => setTimeout(() => setLangDropdownOpen(false), 150)}
              />
              {langDropdownOpen && langMatches.length > 0 && (
                <div className="audio-lang-list">
                  {langMatches.map(l => (
                    <button
                      key={l.code}
                      className="audio-lang-option"
                      onMouseDown={() => selectLang(l)}
                    >
                      {l.label} <span className="audio-lang-code">{l.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="audio-field__hint">{langCode}</span>
          </div>

          <div className="audio-field">
            <label className="audio-field__label">STT Model</label>
            <select
              className="audio-field__select"
              value={model}
              onChange={e => { setModel(e.target.value); saveSttConfig({ model: e.target.value }); }}
            >
              {STT_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="audio-field">
            <label className="audio-field__label">Options</label>
            <label className="audio-checkbox">
              <input type="checkbox" checked={punctuation}
                onChange={e => { setPunctuation(e.target.checked); saveSttConfig({ punctuation: e.target.checked }); }} />
              <span>Automatic punctuation</span>
            </label>
            <label className="audio-checkbox">
              <input type="checkbox" checked={profanity}
                onChange={e => { setProfanity(e.target.checked); saveSttConfig({ profanity: e.target.checked }); }} />
              <span>Profanity filter</span>
            </label>
            <label className="audio-checkbox">
              <input type="checkbox" checked={autosend}
                onChange={e => { setAutosend(e.target.checked); saveSttConfig({ autosend: e.target.checked }); }} />
              <span>Auto-send final results</span>
            </label>
          </div>

          <div className="audio-field">
            <label className="audio-field__label">
              Confidence threshold: <span>{Number(confidence).toFixed(2)}</span>
            </label>
            <input
              className="audio-field__range"
              type="range"
              min="0" max="1" step="0.05"
              value={confidence}
              onChange={e => { setConfidence(e.target.value); saveSttConfig({ confidence: e.target.value }); }}
            />
            <span className="audio-field__hint">Results below this score are shown in red and not auto-sent.</span>
          </div>

          <div className="audio-field">
            <label className="audio-field__label">Max caption length (chars)</label>
            <input
              className="audio-field__input audio-field__input--short"
              type="number"
              min="20" max="500" step="10"
              value={maxLen}
              onChange={e => { setMaxLen(e.target.value); saveSttConfig({ maxLen: e.target.value }); }}
            />
            <span className="audio-field__hint">Long results are split at sentence boundaries then by this limit.</span>
          </div>
        </section>

      </div>
    </div>
  );
}

/**
 * Returns the current STT config for use by audio capture pipeline modules.
 * Import and call this wherever needed (outside React tree).
 */
export function getSttConfig() {
  return loadSttConfig();
}
