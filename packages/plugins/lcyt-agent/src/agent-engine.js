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

  /**
   * Evaluate whether an event description matches the current context.
   * Used for `cue[events]:something happens` rules.
   *
   * @param {string} apiKey
   * @param {string} eventDescription — what should be detected
   * @param {object} [opts]
   * @returns {Promise<{ matched: boolean, confidence: number, reasoning: string }>}
   */
  async evaluateEventCue(apiKey, eventDescription, opts = {}) {
    // Stub — requires LLM integration (Phase 7)
    return {
      matched: false,
      confidence: 0,
      reasoning: 'LLM integration not yet configured',
    };
  }
}
