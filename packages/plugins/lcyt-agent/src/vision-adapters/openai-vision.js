/**
 * OpenAI (GPT-4o-style) vision adapter — chat completions with image_url
 * content parts (base64 data URI). Same envelope shape as
 * agent-engine.js's _callChatCompletion, just with image content parts
 * added to the user message.
 */

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
   * @param {{ model: string, apiKey: string, apiUrl: string }} opts
   */
  constructor({ model, apiKey, apiUrl }) {
    this.model = model;
    this.apiKey = apiKey;
    this.apiUrl = (apiUrl || 'https://api.openai.com').replace(/\/$/, '');
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

    const res = await fetch(`${this.apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI vision API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const message = data?.choices?.[0]?.message?.content;
    if (typeof message !== 'string') throw new Error('Unexpected OpenAI vision response format');
    return parseOutput(message, opts.outputMode);
  }
}
