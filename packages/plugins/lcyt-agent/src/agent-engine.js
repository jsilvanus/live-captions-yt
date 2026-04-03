/**
 * AgentEngine — AI-powered scene understanding and event detection.
 *
 * The Agent is the central AI service for LCYT. It owns:
 * - AI configuration (embedding provider, model, API keys per user)
 * - Embedding computation via OpenAI-compatible APIs
 * - Context window management (STT transcripts + explanation metacodes)
 * - Video/image inference (planned: vision-capable LLM)
 * - Event cues: evaluate `cue[events]:description` rules against context
 *
 * Other plugins (e.g. lcyt-cues CueEngine) delegate embedding calls
 * to the Agent rather than calling the embedding API directly.
 */

import { getAiConfigRaw, runAiMigrations } from './ai-config.js';
import { computeEmbeddings, cosineSimilarity, isServerEmbeddingAvailable } from './embeddings.js';
import logger from 'lcyt/logger';

function parseAssistantJson(text) {
  if (!text || typeof text !== 'string') return null;
  // Strip markdown code fences
  let stripped = text.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();

  // Find outermost JSON object
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  const candidate = (first >= 0 && last > first) ? stripped.slice(first, last + 1) : stripped;

  // Try direct parse
  try { return JSON.parse(candidate); } catch (e) {}

  // Attempt heuristic fixes: single quotes -> double quotes, remove trailing commas
  let heur = candidate.replace(/'/g, '"').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try { return JSON.parse(heur); } catch (e) {}

  // Fallback: extract key/value pairs for matched/confidence/reasoning
  const out = {};
  const mMatched = /"?matched"?\s*:\s*(true|false)/i.exec(candidate);
  if (mMatched) out.matched = mMatched[1].toLowerCase() === 'true';
  const mConf = /"?confidence"?\s*:\s*([0-9.]+)/i.exec(candidate);
  if (mConf) out.confidence = parseFloat(mConf[1]);
  const mReason = /"?reasoning"?\s*:\s*"([^""]{0,500})"/i.exec(candidate);
  if (mReason) out.reasoning = mReason[1];

  // If we got something useful, return it
  if (Object.keys(out).length > 0) return out;
  return null;
}

export class AgentEngine {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {object} [opts]
   */
  constructor(db, opts = {}) {
    /** @type {import('better-sqlite3').Database} */
    this._db = db;

    /**
     * Per-API-key context window: recent STT transcripts + explanations.
     * Map<apiKey, Array<{ type: string, text: string, ts: number }>>
     */
    this._contextWindow = new Map();

    /** Maximum context entries per key. */
    this._maxContextEntries = 50;
  }

  /**
   * Add a context entry (STT transcript, explanation metacode, etc.).
   * @param {string} apiKey
   * @param {string} type — 'transcript', 'explanation', 'scene', 'event'
   * @param {string} text
   */
  addContext(apiKey, type, text) {
    if (!this._contextWindow.has(apiKey)) {
      this._contextWindow.set(apiKey, []);
    }
    const entries = this._contextWindow.get(apiKey);
    entries.push({ type, text, ts: Date.now() });
    // Trim to max size
    if (entries.length > this._maxContextEntries) {
      entries.splice(0, entries.length - this._maxContextEntries);
    }
  }

  /**
   * Get the current context window for an API key.
   * @param {string} apiKey
   * @returns {Array<{ type: string, text: string, ts: number }>}
   */
  getContext(apiKey) {
    return this._contextWindow.get(apiKey) ?? [];
  }

  /**
   * Clear the context window for an API key.
   * @param {string} apiKey
   */
  clearContext(apiKey) {
    this._contextWindow.delete(apiKey);
  }

  // -------------------------------------------------------------------------
  // AI Config helpers — delegates to ai-config.js
  // -------------------------------------------------------------------------

  /**
   * Get AI config for an API key (raw, includes real API key for internal use).
   * @param {string} apiKey
   * @returns {object|null}
   */
  getAiConfig(apiKey) {
    return getAiConfigRaw(this._db, apiKey);
  }

  /**
   * Check if server-level embedding is available (env vars configured).
   * @returns {boolean}
   */
  isServerEmbeddingAvailable() {
    return isServerEmbeddingAvailable();
  }

  // -------------------------------------------------------------------------
  // Embedding helpers — delegates to embeddings.js
  // -------------------------------------------------------------------------

  /**
   * Compute embeddings using the configured provider for the given API key.
   * Resolves provider settings (server / openai / custom) from the DB config.
   *
   * @param {string[]} texts
   * @param {string} [apiKey] — if provided, looks up per-key config
   * @returns {Promise<number[][]>}
   */
  async computeEmbeddings(texts, apiKey) {
    const opts = {};
    if (apiKey) {
      const cfg = getAiConfigRaw(this._db, apiKey);
      if (cfg) {
        if (cfg.embeddingProvider === 'none') {
          throw new Error('Embedding is disabled for this API key (provider: none)');
        }
        if (cfg.embeddingProvider === 'openai' || cfg.embeddingProvider === 'custom') {
          opts.apiKey = cfg.embeddingApiKey;
          opts.model = cfg.embeddingModel;
          if (cfg.embeddingApiUrl) opts.apiUrl = cfg.embeddingApiUrl;
        }
        // 'server' provider uses env vars (no override needed)
      }
    }
    return computeEmbeddings(texts, opts);
  }

  /**
   * Compute cosine similarity between two vectors.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number}
   */
  cosineSimilarity(a, b) {
    return cosineSimilarity(a, b);
  }

  // -------------------------------------------------------------------------
  // Vision / LLM stubs (Phase 6+)
  // -------------------------------------------------------------------------

  /**
   * Analyse a preview image (JPEG buffer or URL) using a vision-capable LLM.
   * Returns a textual description of what is happening on screen.
   *
   * @param {string} apiKey
   * @param {Buffer|string} image — JPEG buffer or URL to the preview image
   * @param {object} [opts]
   * @param {string} [opts.prompt] — custom prompt for the vision model
   * @returns {Promise<{ description: string, confidence: number }>}
   */
  async analyseImage(apiKey, image, opts = {}) {
    // Stub — requires vision-capable LLM integration (Phase 6)
    return {
      description: '',
      confidence: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Event Cue Evaluation (Phase 7)
  // -------------------------------------------------------------------------

  /**
   * Evaluate whether an event description matches the current context.
   * Used for `cue[events]:something happens` rules.
   *
   * Builds a system prompt from the context window (transcripts, explanations,
   * scene descriptions) and asks the LLM whether the described event has
   * occurred. Returns confidence and reasoning.
   *
   * @param {string} apiKey
   * @param {string} eventDescription — what should be detected
   * @param {object} [opts]
   * @param {number} [opts.confidenceThreshold=0.7] — minimum confidence to consider a match
   * @returns {Promise<{ matched: boolean, confidence: number, reasoning: string }>}
   */
  async evaluateEventCue(apiKey, eventDescription, opts = {}) {
    const threshold = opts.confidenceThreshold ?? 0.7;

    // Get AI config for this key
    const cfg = getAiConfigRaw(this._db, apiKey);
    if (!cfg || cfg.embeddingProvider === 'none') {
      return { matched: false, confidence: 0, reasoning: 'AI provider not configured' };
    }

    // Resolve API settings
    const apiSettings = this._resolveApiSettings(cfg);
    if (!apiSettings.apiKey) {
      return { matched: false, confidence: 0, reasoning: 'No API key available' };
    }

    // Build context from the context window
    const context = this.getContext(apiKey);
    if (context.length === 0) {
      return { matched: false, confidence: 0, reasoning: 'No context available' };
    }

    const contextStr = context
      .map(e => `[${e.type}] ${e.text}`)
      .join('\n');

    const systemPrompt =
      'You are an event detection assistant for a live captioning system. ' +
      'You will be given a context window of recent transcripts, scene descriptions, and explanations. ' +
      'You must determine whether a specific event has occurred based on the context. ' +
      'Respond with a JSON object containing: ' +
      '{"matched": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}. ' +
      'Only respond with the JSON object, nothing else.';

    const userPrompt =
      `Context:\n${contextStr}\n\n` +
      `Event to detect: "${eventDescription}"\n\n` +
      'Has this event occurred based on the context above?';

    try {
      const result = await this._callChatCompletion(apiSettings, systemPrompt, userPrompt);

      // Parse LLM response using tolerant helper
      const parsed = parseAssistantJson(result);
      if (!parsed) {
        logger.warn('[agent] Failed to parse assistant JSON response');
        return { matched: false, confidence: 0, reasoning: 'Failed to parse LLM response' };
      }

      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
      const matched = parsed.matched === true && confidence >= threshold;

      return { matched, confidence, reasoning };
    } catch (err) {
      return { matched: false, confidence: 0, reasoning: `LLM error: ${err.message}` };
    }
  }

  /**
   * Resolve API settings from an AI config object.
   * @param {object} cfg — raw AI config from DB
   * @returns {{ apiUrl: string, apiKey: string, model: string }}
   */
  _resolveApiSettings(cfg) {    if (cfg.embeddingProvider === 'server') {
      return {
        apiUrl: process.env.EMBEDDING_API_URL || 'https://api.openai.com',
        apiKey: process.env.EMBEDDING_API_KEY || '',
        model: process.env.EMBEDDING_MODEL || 'gpt-4o-mini',
      };
    }
    return {
      apiUrl: cfg.embeddingApiUrl || 'https://api.openai.com',
      apiKey: cfg.embeddingApiKey || '',
      model: cfg.embeddingModel || 'gpt-4o-mini',
    };
  }

  // -------------------------------------------------------------------------
  // Phase 5 — AI DSK Template Generation
  // -------------------------------------------------------------------------

  /**
   * Generate a new DSK template from a natural-language prompt.
   * Returns a template JSON compatible with the DSK editor format.
   *
   * @param {string} apiKey
   * @param {string} prompt — e.g. "A lower-third with speaker name and title"
   * @param {object} [opts]
   * @param {number} [opts.width=1920]
   * @param {number} [opts.height=1080]
   * @returns {Promise<object>} — template JSON
   */
  async generateTemplate(apiKey, prompt, opts = {}) {
    const w = opts.width || 1920;
    const h = opts.height || 1080;
    const EMPTY = { background: 'transparent', width: w, height: h, groups: [], layers: [] };

    const cfg = getAiConfigRaw(this._db, apiKey);
    if (!cfg || cfg.embeddingProvider === 'none') return EMPTY;

    const apiSettings = this._resolveApiSettings(cfg);
    if (!apiSettings.apiKey) return EMPTY;

    const systemPrompt =
      'You are a DSK (Downstream Key) graphics template designer for a live-captioning broadcast system. ' +
      'Generate a JSON template with this exact shape:\n' +
      '{ "background": "transparent", "width": ' + w + ', "height": ' + h + ', "groups": [], "layers": [...] }\n' +
      'Each layer must be one of these types:\n' +
      '  { "id": "rect-1", "type": "rect", "x": 0, "y": 880, "width": 800, "height": 200, "style": { "background": "#1a1a1a", "opacity": "0.85", "border-radius": "8px" } }\n' +
      '  { "id": "text-1", "type": "text", "x": 40, "y": 910, "text": "{{name}}", "style": { "font-size": "48px", "font-family": "Arial, sans-serif", "color": "#ffffff", "font-weight": "bold" } }\n' +
      '  { "id": "ellipse-1", "type": "ellipse", "x": 200, "y": 200, "width": 200, "height": 200, "style": { "background": "#336699" } }\n' +
      '  { "id": "image-1", "type": "image", "x": 0, "y": 0, "width": 200, "height": 200, "src": "" }\n' +
      'Rules:\n' +
      '- All coordinates are in pixels relative to the ' + w + 'x' + h + ' canvas.\n' +
      '- Use {{name}}, {{title}}, {{text}} etc. as variable placeholders in text layers.\n' +
      '- Respond ONLY with the JSON object, no markdown, no explanation.';

    const userPrompt = `Create a DSK template: ${prompt}`;

    try {
      const raw = await this._callChatCompletion(apiSettings, systemPrompt, userPrompt, { temperature: 0.7, maxTokens: 2000 });
      const parsed = parseAssistantJson(raw);
      if (!parsed || !Array.isArray(parsed.layers)) return EMPTY;
      let counter = 0;
      parsed.layers = parsed.layers.map(l => ({
        ...l,
        id: typeof l.id === 'string' && l.id ? l.id : `${l.type || 'layer'}-${++counter}`,
      }));
      return {
        background: typeof parsed.background === 'string' ? parsed.background : 'transparent',
        width: parsed.width || w,
        height: parsed.height || h,
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        layers: parsed.layers,
      };
    } catch (err) {
      logger.warn('[agent] generateTemplate error: ' + err.message);
      return EMPTY;
    }
  }

  /**
   * Edit an existing DSK template based on a natural-language instruction.
   *
   * @param {string} apiKey
   * @param {object} template — existing template JSON
   * @param {string} prompt — e.g. "Make the background darker"
   * @param {object} [opts]
   * @returns {Promise<object>} — modified template JSON
   */
  async editTemplate(apiKey, template, prompt, opts = {}) {
    const cfg = getAiConfigRaw(this._db, apiKey);
    if (!cfg || cfg.embeddingProvider === 'none') return template;

    const apiSettings = this._resolveApiSettings(cfg);
    if (!apiSettings.apiKey) return template;

    const systemPrompt =
      'You are a DSK (Downstream Key) graphics template editor for a live-captioning broadcast system. ' +
      'You will receive an existing template JSON and an edit instruction. ' +
      'Apply the instruction to the template and return the complete modified template JSON. ' +
      'Preserve all layer ids and types unless the instruction explicitly says to change them. ' +
      'Respond ONLY with the complete JSON object, no markdown, no explanation.';

    const userPrompt =
      `Existing template:\n${JSON.stringify(template, null, 2)}\n\n` +
      `Edit instruction: ${prompt}`;

    try {
      const raw = await this._callChatCompletion(apiSettings, systemPrompt, userPrompt, { temperature: 0.7, maxTokens: 2000 });
      const parsed = parseAssistantJson(raw);
      if (!parsed || !Array.isArray(parsed.layers)) return template;
      let counter = 0;
      parsed.layers = parsed.layers.map(l => ({
        ...l,
        id: typeof l.id === 'string' && l.id ? l.id : `${l.type || 'layer'}-${++counter}`,
      }));
      return {
        background: typeof parsed.background === 'string' ? parsed.background : (template.background || 'transparent'),
        width: parsed.width || template.width || 1920,
        height: parsed.height || template.height || 1080,
        groups: Array.isArray(parsed.groups) ? parsed.groups : (template.groups || []),
        layers: parsed.layers,
      };
    } catch (err) {
      logger.warn('[agent] editTemplate error: ' + err.message);
      return template;
    }
  }

  /**
   * Suggest color schemes, font pairings, and style improvements for a DSK template.
   *
   * @param {string} apiKey
   * @param {object} template — existing template JSON
   * @param {object} [opts]
   * @returns {Promise<Array<{ name: string, description: string, changes: object }>>}
   */
  async suggestStyles(apiKey, template, opts = {}) {
    const cfg = getAiConfigRaw(this._db, apiKey);
    if (!cfg || cfg.embeddingProvider === 'none') return [];

    const apiSettings = this._resolveApiSettings(cfg);
    if (!apiSettings.apiKey) return [];

    const systemPrompt =
      'You are a broadcast graphics designer. ' +
      'Given a DSK template JSON, suggest 3 style variations (colour schemes, font pairings, layout improvements). ' +
      'Respond ONLY with a JSON array of suggestions in this shape:\n' +
      '[\n' +
      '  { "name": "Dark Corporate", "description": "Deep blue with white text", "changes": { "background": "#0a0f2c", "textColor": "#ffffff" } },\n' +
      '  ...\n' +
      ']\n' +
      'No markdown, no explanation — only the JSON array.';

    const userPrompt = `Template:\n${JSON.stringify(template, null, 2)}`;

    try {
      const raw = await this._callChatCompletion(apiSettings, systemPrompt, userPrompt, { temperature: 0.8, maxTokens: 1000 });
      // The response is an array, not an object
      let parsed;
      try {
        const stripped = raw.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
        parsed = JSON.parse(stripped);
      } catch {
        parsed = parseAssistantJson(raw);
      }
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch (err) {
      logger.warn('[agent] suggestStyles error: ' + err.message);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Phase 6 — AI-Assisted Rundown Creation
  // -------------------------------------------------------------------------

  /**
   * Metacode syntax reference injected into rundown generation prompts.
   * @returns {string}
   */
  static get RUNDOWN_METACODE_REFERENCE() {
    return (
      'LCYT Rundown Metacode Syntax (use these HTML comment markers in the text):\n' +
      '  <!-- section: Section Name -->    — starts a new named section\n' +
      '  <!-- speaker: Name -->            — sets the current speaker\n' +
      '  <!-- lang: fi-FI -->              — sets the caption language (BCP-47 tag)\n' +
      '  <!-- cue: phrase -->              — advance on exact phrase match\n' +
      '  <!-- cue*: phrase -->             — skip-mode cue (jumps past queued cues)\n' +
      '  <!-- cue~: phrase -->             — fuzzy phrase match\n' +
      '  <!-- explanation: text -->        — operator/AI context note (not displayed)\n' +
      '  <!-- graphics: template-name --> — activate a named DSK template\n' +
      '  <!-- graphics: -->               — clear graphics\n' +
      '  <!-- timer: N -->                — pause N seconds\n' +
      '\n' +
      'Each non-empty text line (not starting with <!--) is a caption line. ' +
      'Blank lines separate sections. ' +
      'Headings are plain text lines that summarise what follows.'
    );
  }

  /**
   * Built-in rundown template library for common event types.
   * @returns {Object.<string, string>}
   */
  static get RUNDOWN_TEMPLATE_LIBRARY() {
    return {
      church_service: [
        '<!-- section: Welcome -->',
        '<!-- speaker: Host -->',
        '<!-- cue: welcome everyone -->',
        'Welcome to the service.',
        '',
        '<!-- section: Opening Prayer -->',
        '<!-- speaker: Pastor -->',
        '<!-- explanation: Pastor leads opening prayer -->',
        '<!-- cue: let us pray -->',
        '',
        '<!-- section: Readings -->',
        '<!-- cue: reading from -->',
        '',
        '<!-- section: Sermon -->',
        '<!-- speaker: Pastor -->',
        '<!-- cue: the sermon topic today -->',
        '',
        '<!-- section: Offering -->',
        '<!-- cue: time for the offering -->',
        '',
        '<!-- section: Closing -->',
        '<!-- cue: thank you for joining -->',
      ].join('\n'),

      concert: [
        '<!-- section: Introduction -->',
        '<!-- speaker: Announcer -->',
        '<!-- cue: welcome to tonight -->',
        '',
        '<!-- section: Song 1 -->',
        '<!-- lang: en -->',
        '<!-- cue: starts playing -->',
        '',
        '<!-- section: Between Songs -->',
        '<!-- speaker: Artist -->',
        '<!-- cue: thank you so much -->',
        '',
        '<!-- section: Finale -->',
        '<!-- cue: our final song tonight -->',
      ].join('\n'),

      conference: [
        '<!-- section: Opening Remarks -->',
        '<!-- speaker: Chair -->',
        '<!-- cue: good morning everyone -->',
        '',
        '<!-- section: Keynote -->',
        '<!-- speaker: Speaker -->',
        '<!-- explanation: Main keynote presentation -->',
        '<!-- cue: thank you for that introduction -->',
        '',
        '<!-- section: Q&A -->',
        '<!-- cue: now open for questions -->',
        '',
        '<!-- section: Closing -->',
        '<!-- speaker: Chair -->',
        '<!-- cue: thank you for attending -->',
      ].join('\n'),

      sports: [
        '<!-- section: Pre-Match -->',
        '<!-- speaker: Commentator -->',
        "<!-- cue: welcome to today's match -->",
        '',
        '<!-- section: Match -->',
        '<!-- explanation: Live match commentary -->',
        '',
        '<!-- section: Half-Time -->',
        '<!-- cue: that\'s half time -->',
        '',
        '<!-- section: Second Half -->',
        '',
        '<!-- section: Full Time -->',
        '<!-- cue: the final whistle -->',
      ].join('\n'),
    };
  }

  /**
   * Generate a new rundown from a natural-language prompt.
   *
   * @param {string} apiKey
   * @param {string} prompt — e.g. "A church service with opening prayer and sermon"
   * @param {object} [opts]
   * @param {string} [opts.templateId] — optional built-in template key to use as a base
   * @returns {Promise<string>} — rundown text with metacodes
   */
  async generateRundown(apiKey, prompt, opts = {}) {
    const cfg = getAiConfigRaw(this._db, apiKey);
    if (!cfg || cfg.embeddingProvider === 'none') return '';

    const apiSettings = this._resolveApiSettings(cfg);
    if (!apiSettings.apiKey) return '';

    const lib = AgentEngine.RUNDOWN_TEMPLATE_LIBRARY;
    const baseTemplate = opts.templateId && lib[opts.templateId] ? lib[opts.templateId] : null;

    const systemPrompt =
      'You are an expert live-event script writer for a captioning system. ' +
      'Generate a rundown (script) using LCYT metacode syntax for live captions.\n\n' +
      AgentEngine.RUNDOWN_METACODE_REFERENCE + '\n\n' +
      'Guidelines:\n' +
      '- Start each major section with <!-- section: Name -->\n' +
      '- Insert <!-- cue: phrase --> before key lines where the operator should advance\n' +
      '- Use <!-- speaker: Name --> when the speaker changes\n' +
      '- Keep captions short (1-2 sentences per line)\n' +
      '- Return ONLY the rundown text, no explanation, no markdown fences.';

    const userPrompt = baseTemplate
      ? `Starting from this template:\n${baseTemplate}\n\nCustomise it for: ${prompt}`
      : `Generate a complete rundown for: ${prompt}`;

    try {
      return await this._callChatCompletion(apiSettings, systemPrompt, userPrompt, { temperature: 0.8, maxTokens: 3000 });
    } catch (err) {
      logger.warn('[agent] generateRundown error: ' + err.message);
      return '';
    }
  }

  /**
   * Edit an existing rundown based on a natural-language instruction.
   *
   * @param {string} apiKey
   * @param {string} content — existing rundown text
   * @param {string} prompt — e.g. "Add a 5-second silence cue before the sermon"
   * @param {object} [opts]
   * @returns {Promise<string>} — modified rundown text
   */
  async editRundown(apiKey, content, prompt, opts = {}) {
    const cfg = getAiConfigRaw(this._db, apiKey);
    if (!cfg || cfg.embeddingProvider === 'none') return content;

    const apiSettings = this._resolveApiSettings(cfg);
    if (!apiSettings.apiKey) return content;

    const systemPrompt =
      'You are an expert live-event script editor for a captioning system. ' +
      'You will receive an existing rundown and an edit instruction. ' +
      'Apply the instruction to the rundown, preserving all existing metacodes unless the instruction says to change them.\n\n' +
      AgentEngine.RUNDOWN_METACODE_REFERENCE + '\n\n' +
      'Return ONLY the complete modified rundown text, no explanation, no markdown fences.';

    const userPrompt =
      `Existing rundown:\n${content}\n\n` +
      `Edit instruction: ${prompt}`;

    try {
      return await this._callChatCompletion(apiSettings, systemPrompt, userPrompt, { temperature: 0.8, maxTokens: 3000 });
    } catch (err) {
      logger.warn('[agent] editRundown error: ' + err.message);
      return content;
    }
  }

  /**
   * Call an OpenAI-compatible chat completion endpoint.
   * @param {{ apiUrl: string, apiKey: string, model: string }} settings
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {object} [opts]
   * @param {number} [opts.temperature=0.1]
   * @param {number} [opts.maxTokens=200]
   * @returns {Promise<string>} — the assistant's message content
   */
  async _callChatCompletion(settings, systemPrompt, userPrompt, opts = {}) {
    const url = `${settings.apiUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    };

    const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.1;
    const maxTokens = typeof opts.maxTokens === 'number' ? opts.maxTokens : 200;

    const body = JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // Temperature and max tokens can be overridden by opts
      temperature: temperature,
      max_tokens: maxTokens,
    });

    // Retry on transient failures (network / 5xx / rate-limit)
    const MAX_RETRIES = 2;
    let attempt = 0;
    let res = null;
    let lastErr = null;
    while (attempt <= MAX_RETRIES) {
      try {
        res = await fetch(url, { method: 'POST', headers, body });
        if (res.ok) break;
        const status = res.status;
        const errText = await res.text().catch(() => '');
        if (status === 429 || status >= 500) {
          lastErr = new Error(`Chat API error ${status}: ${errText.slice(0,200)}`);
          attempt++;
          await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt)));
          continue;
        }
        throw new Error(`Chat API error ${status}: ${errText.slice(0,200)}`);
      } catch (err) {
        lastErr = err;
        if (attempt >= MAX_RETRIES) throw err;
        attempt++;
        await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt)));
      }
    }
    if (!res || !res.ok) throw lastErr || new Error('Chat API request failed');
    const data = await res.json();
    const message = data?.choices?.[0]?.message?.content;
    if (typeof message !== 'string') {
      throw new Error('Unexpected chat API response format');
    }
    return message;
  }
}
