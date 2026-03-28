/**
 * AgentEngine — AI-powered scene understanding and event detection.
 *
 * Capabilities (planned phases):
 * - Video/image inference: analyse preview JPEGs or video frames to describe
 *   on-screen activity using a vision-capable LLM.
 * - Context enrichment: combine STT transcripts, `<!-- explanation:... -->`
 *   metacodes, and visual analysis to build a rich scene context.
 * - Event cues: evaluate `cue[events]:description` rules by asking an LLM
 *   whether the described event has occurred given the current context.
 * - Continuous monitoring: periodically analyse preview frames and emit
 *   scene_description SSE events.
 *
 * The engine delegates to the AI configuration module (packages/lcyt-backend/src/ai/)
 * for model access and provider configuration.
 */

export class AgentEngine {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {object} [opts]
   * @param {object} [opts.aiConfig] — AI configuration module reference
   */
  constructor(db, opts = {}) {
    /** @type {import('better-sqlite3').Database} */
    this._db = db;

    /** @type {object|null} */
    this._aiConfig = opts.aiConfig ?? null;

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
