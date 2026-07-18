/**
 * Anthropic Claude vision adapter — Messages API, base64 image content
 * blocks.
 */

import { invokeModelCall } from '../agentic-turn.js';

const ANTHROPIC_VERSION = '2023-06-01';

function parseOutput(text, outputMode) {
  if (outputMode !== 'json') return { text, json: null, raw: text };
  const stripped = text.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
  try {
    return { text: null, json: JSON.parse(stripped), raw: text };
  } catch {
    return { text, json: null, raw: text };
  }
}

export class AnthropicVisionAdapter {
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
    this.apiUrl = (apiUrl || 'https://api.anthropic.com').replace(/\/$/, '');
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
    const content = [
      { type: 'text', text: opts.outputMode === 'json' ? `${promptText}\n\nRespond with JSON only, no markdown.` : promptText },
      ...imageBuffers.map((buf) => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
      })),
    ];

    const result = await invokeModelCall({
      apiUrl: this.apiUrl,
      apiKey: '', // Anthropic auth is the x-api-key header below, not a bearer token
      model: this.model,
      transport: this.transport,
      bridgeManager: this.bridgeManager,
      bridgeInstanceId: this.bridgeInstanceId,
    }, {
      model: this.model,
      max_tokens: 500,
      messages: [{ role: 'user', content }],
    }, {
      endpointPath: '/v1/messages',
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    });
    const data = result.body;
    const text = data?.content?.[0]?.text;
    if (typeof text !== 'string') throw new Error('Unexpected Anthropic vision response format');
    return parseOutput(text, opts.outputMode);
  }
}
