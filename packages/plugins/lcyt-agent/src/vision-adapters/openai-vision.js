/**
 * OpenAI (GPT-4o-style) vision adapter — chat completions with image_url
 * content parts (base64 data URI). Same envelope shape as
 * agent-engine.js's _callChatCompletion, just with image content parts
 * added to the user message.
 */

import { invokeModelCall } from '../agentic-turn.js';

/**
 * @param {{ text: string|null, json: object|null, raw: string }} parsed
 */
function parseOutput(content, outputMode) {
  if (outputMode !== 'json') return { text: content, json: null, raw: content };
  const stripped = content.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
  try {
    return { text: null, json: JSON.parse(stripped), raw: content };
  } catch {
    return { text: content, json: null, raw: content };
  }
}

export class OpenAiVisionAdapter {
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
    this.apiUrl = (apiUrl || 'https://api.openai.com').replace(/\/$/, '');
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
      { type: 'text', text: promptText },
      ...imageBuffers.map((buf) => ({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` },
      })),
    ];

    const body = {
      model: this.model,
      messages: [{ role: 'user', content }],
      max_tokens: 500,
      ...(opts.outputMode === 'json' ? { response_format: { type: 'json_object' } } : {}),
    };

    const result = await invokeModelCall({
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      model: this.model,
      transport: this.transport,
      bridgeManager: this.bridgeManager,
      bridgeInstanceId: this.bridgeInstanceId,
    }, body);
    const data = result.body;
    const message = data?.choices?.[0]?.message?.content;
    if (typeof message !== 'string') throw new Error('Unexpected OpenAI vision response format');
    return parseOutput(message, opts.outputMode);
  }
}
