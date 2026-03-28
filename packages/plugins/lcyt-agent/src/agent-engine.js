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

      // Parse LLM response — extract JSON object robustly
      let parsed;
      try {
        // Strip markdown code blocks, then find the outermost { ... } object
        const stripped = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
        const firstBrace = stripped.indexOf('{');
        const lastBrace = stripped.lastIndexOf('}');
        const jsonStr = firstBrace >= 0 && lastBrace > firstBrace
          ? stripped.slice(firstBrace, lastBrace + 1)
          : stripped;
        parsed = JSON.parse(jsonStr);
      } catch {
        return { matched: false, confidence: 0, reasoning: `Failed to parse LLM response: ${result.slice(0, 100)}` };
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
  _resolveApiSettings(cfg) {
    if (cfg.embeddingProvider === 'server') {
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

  /**
   * Call an OpenAI-compatible chat completion endpoint.
   * @param {{ apiUrl: string, apiKey: string, model: string }} settings
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @returns {Promise<string>} — the assistant's message content
   */
  async _callChatCompletion(settings, systemPrompt, userPrompt) {
    const url = `${settings.apiUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    };

    const body = JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // Low temperature for deterministic event detection (not creative)
      temperature: 0.1,
      // Short response — only need a JSON object with matched/confidence/reasoning
      max_tokens: 200,
    });

    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Chat API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const message = data?.choices?.[0]?.message?.content;
    if (typeof message !== 'string') {
      throw new Error('Unexpected chat API response format');
    }
    return message;
  }
}
