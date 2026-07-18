/**
 * Google Gemini vision adapter — generateContent REST endpoint, inline_data
 * parts. Auth follows this repo's existing Google REST-API-key convention
 * (see lcyt-rtmp's GoogleSttAdapter / GOOGLE_STT_KEY) rather than a service
 * account — simplest path for a per-provider apiKey stored in ai_providers.
 */

import { invokeModelCall } from '../agentic-turn.js';

function parseOutput(text, outputMode) {
  if (outputMode !== 'json') return { text, json: null, raw: text };
  const stripped = text.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
  try {
    return { text: null, json: JSON.parse(stripped), raw: text };
  } catch {
    return { text, json: null, raw: text };
  }
}

export class GoogleVisionAdapter {
  /**
   * @param {{
   *   model: string,
   *   apiKey: string,
   *   apiUrl: string,
   *   transport?: string,
   *   bridgeManager?: object,
   *   bridgeInstanceId?: string,
   * }} opts
   */
  constructor({ model, apiKey, apiUrl, transport, bridgeManager, bridgeInstanceId }) {
    this.model = model;
    this.apiKey = apiKey;
    this.apiUrl = (apiUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    this.transport = transport;
    this.bridgeManager = bridgeManager;
    this.bridgeInstanceId = bridgeInstanceId;
  }

  /**
   * @param {Buffer[]} imageBuffers — JPEG bytes
   * @param {string} promptText
   * @param {{ outputMode?: 'text'|'json', jsonSchema?: object }} [opts]
   * @returns {Promise<{ text: string|null, json: object|null, raw: string }>}
   */
  async analyse(imageBuffers, promptText, opts = {}) {
    const parts = [
      { text: promptText },
      ...imageBuffers.map((buf) => ({ inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } })),
    ];

    const body = {
      contents: [{ parts }],
      ...(opts.outputMode === 'json' ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    };

    const endpointPath = `/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const result = await invokeModelCall({
      apiUrl: this.apiUrl,
      apiKey: '', // auth is the ?key= query param above, not a bearer header
      model: this.model,
      transport: this.transport,
      bridgeManager: this.bridgeManager,
      bridgeInstanceId: this.bridgeInstanceId,
    }, body, { endpointPath });
    const data = result.body;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw new Error('Unexpected Google vision response format');
    return parseOutput(text, opts.outputMode);
  }
}
