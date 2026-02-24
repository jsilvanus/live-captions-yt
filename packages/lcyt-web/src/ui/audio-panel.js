// Audio & STT settings panel — shown in the left column when the Audio tab is active.
//
// Covers P2-Milestone 1 (audio source selection) and P2-Milestone 5 (STT config).
// Actual capture/streaming wiring is done in later milestones; this provides the UI.

const STORAGE_KEY_DEVICE   = 'lcyt-audio-device';
const STORAGE_KEY_STT_LANG = 'lcyt-stt-lang';
const STORAGE_KEY_STT_CFG  = 'lcyt-stt-config';

const STT_MODELS = [
  { value: 'latest_long',        label: 'Latest Long' },
  { value: 'latest_short',       label: 'Latest Short' },
  { value: 'telephony',          label: 'Telephony' },
  { value: 'video',              label: 'Video' },
  { value: 'medical_dictation',  label: 'Medical Dictation' },
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
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_STT_CFG) || '{}');
  } catch {
    return {};
  }
}

function saveSttConfig(patch) {
  const cfg = loadSttConfig();
  localStorage.setItem(STORAGE_KEY_STT_CFG, JSON.stringify({ ...cfg, ...patch }));
}

export function createAudioPanel(container) {
  const el = document.createElement('div');
  el.className = 'audio-panel';
  el.style.display = 'none';

  // ── Build inner HTML ───────────────────────────────────────────────────────

  el.innerHTML = `
    <div class="audio-panel__scroll">

      <!-- ── Audio Source ─────────────────────────────────────── -->
      <section class="audio-section">
        <h3 class="audio-section__title">Audio Source</h3>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-device-select">Microphone</label>
          <div class="audio-field__row">
            <select id="ap-device-select" class="audio-field__select">
              <option value="">— select a device —</option>
            </select>
            <button id="ap-refresh-btn" class="btn btn--secondary btn--sm" title="Refresh device list">&#8635;</button>
          </div>
        </div>

        <div class="audio-field">
          <label class="audio-field__label">Microphone Permission</label>
          <div class="audio-field__row">
            <span id="ap-perm-status" class="audio-perm-status audio-perm-status--unknown">Unknown</span>
            <button id="ap-perm-btn" class="btn btn--secondary btn--sm">Request Permission</button>
          </div>
        </div>

        <div class="audio-field">
          <label class="audio-field__label">Audio Level</label>
          <canvas id="ap-meter-canvas" class="audio-meter" width="300" height="20" title="Audio level meter (active when listening)"></canvas>
        </div>

        <div class="audio-field audio-field--actions">
          <button id="ap-start-btn" class="btn btn--primary" disabled>&#9654; Start Listening</button>
          <button id="ap-stop-btn"  class="btn btn--secondary" disabled style="display:none">&#9632; Stop Listening</button>
          <span id="ap-listen-status" class="audio-listen-status"></span>
        </div>
      </section>

      <!-- ── STT Settings ──────────────────────────────────────── -->
      <section class="audio-section">
        <h3 class="audio-section__title">Speech Recognition (STT)</h3>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-lang-input">Language</label>
          <div class="audio-lang-wrap">
            <input id="ap-lang-input" class="audio-field__input" type="text"
                   placeholder="Type to filter…" autocomplete="off" spellcheck="false" />
            <div id="ap-lang-list" class="audio-lang-list" style="display:none"></div>
          </div>
          <span id="ap-lang-selected" class="audio-field__hint"></span>
        </div>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-model-select">STT Model</label>
          <select id="ap-model-select" class="audio-field__select">
            ${STT_MODELS.map(m =>
              `<option value="${m.value}">${m.label}</option>`
            ).join('')}
          </select>
        </div>

        <div class="audio-field">
          <label class="audio-field__label">Options</label>
          <label class="audio-checkbox">
            <input type="checkbox" id="ap-punctuation-chk" checked />
            <span>Automatic punctuation</span>
          </label>
          <label class="audio-checkbox">
            <input type="checkbox" id="ap-profanity-chk" />
            <span>Profanity filter</span>
          </label>
          <label class="audio-checkbox">
            <input type="checkbox" id="ap-autosend-chk" />
            <span>Auto-send final results</span>
          </label>
        </div>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-confidence-slider">
            Confidence threshold: <span id="ap-confidence-val">0.70</span>
          </label>
          <input id="ap-confidence-slider" class="audio-field__range" type="range"
                 min="0" max="1" step="0.05" value="0.70" />
          <span class="audio-field__hint">Results below this score are shown in red and not auto-sent.</span>
        </div>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-maxlen-input">
            Max caption length (chars)
          </label>
          <input id="ap-maxlen-input" class="audio-field__input audio-field__input--short" type="number"
                 min="20" max="500" step="10" value="80" />
          <span class="audio-field__hint">Long results are split at sentence boundaries then by this limit.</span>
        </div>
      </section>

    </div>
  `;

  container.appendChild(el);

  // ── Element refs ──────────────────────────────────────────────────────────

  const deviceSelect     = el.querySelector('#ap-device-select');
  const refreshBtn       = el.querySelector('#ap-refresh-btn');
  const permStatus       = el.querySelector('#ap-perm-status');
  const permBtn          = el.querySelector('#ap-perm-btn');
  const meterCanvas      = el.querySelector('#ap-meter-canvas');
  const startBtn         = el.querySelector('#ap-start-btn');
  const stopBtn          = el.querySelector('#ap-stop-btn');
  const listenStatus     = el.querySelector('#ap-listen-status');
  const langInput        = el.querySelector('#ap-lang-input');
  const langList         = el.querySelector('#ap-lang-list');
  const langSelected     = el.querySelector('#ap-lang-selected');
  const modelSelect      = el.querySelector('#ap-model-select');
  const punctuationChk   = el.querySelector('#ap-punctuation-chk');
  const profanityChk     = el.querySelector('#ap-profanity-chk');
  const autosendChk      = el.querySelector('#ap-autosend-chk');
  const confidenceSlider = el.querySelector('#ap-confidence-slider');
  const confidenceVal    = el.querySelector('#ap-confidence-val');
  const maxlenInput      = el.querySelector('#ap-maxlen-input');

  // ── Restore persisted config ───────────────────────────────────────────────

  const cfg = loadSttConfig();

  if (cfg.model)       modelSelect.value      = cfg.model;
  if (cfg.punctuation !== undefined) punctuationChk.checked = cfg.punctuation;
  if (cfg.profanity   !== undefined) profanityChk.checked   = cfg.profanity;
  if (cfg.autosend    !== undefined) autosendChk.checked    = cfg.autosend;
  if (cfg.confidence  !== undefined) {
    confidenceSlider.value = cfg.confidence;
    confidenceVal.textContent = Number(cfg.confidence).toFixed(2);
  }
  if (cfg.maxLen) maxlenInput.value = cfg.maxLen;

  // Language
  const savedLang = localStorage.getItem(STORAGE_KEY_STT_LANG) || 'en-US';
  const savedLangEntry = COMMON_LANGUAGES.find(l => l.code === savedLang);
  langInput.value = savedLangEntry ? savedLangEntry.label : savedLang;
  langSelected.textContent = savedLang;

  // ── Audio device enumeration ───────────────────────────────────────────────

  async function enumerateDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      deviceSelect.innerHTML = '<option value="">Not supported in this browser</option>';
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs  = devices.filter(d => d.kind === 'audioinput');

      const savedDevice = localStorage.getItem(STORAGE_KEY_DEVICE) || '';

      deviceSelect.innerHTML = '<option value="">— select a device —</option>';
      inputs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`;
        if (d.deviceId === savedDevice) opt.selected = true;
        deviceSelect.appendChild(opt);
      });

      // Update start button state
      updateStartBtn();
    } catch (err) {
      deviceSelect.innerHTML = `<option value="">Error: ${err.message}</option>`;
    }
  }

  function updateStartBtn() {
    const hasDevice = deviceSelect.value !== '';
    startBtn.disabled = !hasDevice;
  }

  deviceSelect.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY_DEVICE, deviceSelect.value);
    updateStartBtn();
  });

  refreshBtn.addEventListener('click', enumerateDevices);

  // Listen for device changes (plug/unplug)
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
  }

  // ── Microphone permission ─────────────────────────────────────────────────

  async function checkPermission() {
    if (!navigator.permissions) return;
    try {
      const result = await navigator.permissions.query({ name: 'microphone' });
      updatePermStatus(result.state);
      result.addEventListener('change', () => updatePermStatus(result.state));
    } catch {
      // permissions API may not support 'microphone' in all browsers
    }
  }

  function updatePermStatus(state) {
    permStatus.textContent = state.charAt(0).toUpperCase() + state.slice(1);
    permStatus.className = `audio-perm-status audio-perm-status--${state}`;
    if (state === 'granted') enumerateDevices(); // re-enumerate to get labels
  }

  permBtn.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      updatePermStatus('granted');
      await enumerateDevices();
    } catch (err) {
      updatePermStatus('denied');
    }
  });

  // ── Audio level meter (placeholder canvas — filled in P2-M2) ─────────────

  const ctx2d = meterCanvas.getContext('2d');
  function drawMeterIdle() {
    ctx2d.clearRect(0, 0, meterCanvas.width, meterCanvas.height);
    ctx2d.fillStyle = 'var(--color-surface-elevated, #2a2a2a)';
    ctx2d.fillRect(0, 0, meterCanvas.width, meterCanvas.height);
    ctx2d.fillStyle = 'var(--color-border, #444)';
    ctx2d.font = '10px sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText('Audio level — active when listening', meterCanvas.width / 2, meterCanvas.height / 2);
  }
  drawMeterIdle();

  // ── Start / Stop listening buttons ────────────────────────────────────────

  startBtn.addEventListener('click', () => {
    // Full wiring happens in P2-M2; dispatch event for future capture module
    window.dispatchEvent(new CustomEvent('lcyt:audio-start', {
      detail: { deviceId: deviceSelect.value }
    }));
    startBtn.style.display = 'none';
    stopBtn.style.display  = '';
    listenStatus.textContent = 'Listening…';
    listenStatus.className   = 'audio-listen-status audio-listen-status--active';
  });

  stopBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('lcyt:audio-stop'));
    stopBtn.style.display  = 'none';
    startBtn.style.display = '';
    listenStatus.textContent = '';
    listenStatus.className   = 'audio-listen-status';
    drawMeterIdle();
  });

  // ── Language typeahead ────────────────────────────────────────────────────

  langInput.addEventListener('input', () => {
    const q = langInput.value.trim().toLowerCase();
    if (!q) {
      langList.style.display = 'none';
      return;
    }
    const matches = COMMON_LANGUAGES.filter(l =>
      l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)
    );
    if (matches.length === 0) {
      langList.style.display = 'none';
      return;
    }
    langList.innerHTML = matches.map(l =>
      `<button class="audio-lang-option" data-code="${l.code}">${l.label} <span class="audio-lang-code">${l.code}</span></button>`
    ).join('');
    langList.style.display = '';
  });

  langList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-code]');
    if (!btn) return;
    const code = btn.dataset.code;
    const entry = COMMON_LANGUAGES.find(l => l.code === code);
    langInput.value = entry ? entry.label : code;
    langSelected.textContent = code;
    langList.style.display = 'none';
    localStorage.setItem(STORAGE_KEY_STT_LANG, code);
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!langInput.contains(e.target) && !langList.contains(e.target)) {
      langList.style.display = 'none';
    }
  });

  // ── Confidence slider ─────────────────────────────────────────────────────

  confidenceSlider.addEventListener('input', () => {
    confidenceVal.textContent = Number(confidenceSlider.value).toFixed(2);
    saveSttConfig({ confidence: confidenceSlider.value });
  });

  // ── Persist STT config on change ─────────────────────────────────────────

  modelSelect.addEventListener('change',    () => saveSttConfig({ model: modelSelect.value }));
  punctuationChk.addEventListener('change', () => saveSttConfig({ punctuation: punctuationChk.checked }));
  profanityChk.addEventListener('change',   () => saveSttConfig({ profanity: profanityChk.checked }));
  autosendChk.addEventListener('change',    () => saveSttConfig({ autosend: autosendChk.checked }));
  maxlenInput.addEventListener('change',    () => saveSttConfig({ maxLen: maxlenInput.value }));

  // ── Init ──────────────────────────────────────────────────────────────────

  checkPermission();
  enumerateDevices();

  return {
    element: el,
    show() { el.style.display = ''; },
    hide() { el.style.display = 'none'; },
    /** Returns the current STT config object for use by later pipeline modules. */
    getSttConfig() {
      return {
        deviceId:    deviceSelect.value,
        language:    langSelected.textContent || 'en-US',
        model:       modelSelect.value,
        punctuation: punctuationChk.checked,
        profanity:   profanityChk.checked,
        autosend:    autosendChk.checked,
        confidence:  parseFloat(confidenceSlider.value),
        maxLen:      parseInt(maxlenInput.value, 10) || 80,
      };
    },
  };
}
