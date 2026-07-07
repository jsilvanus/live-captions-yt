/**
 * Google Gemini vision adapter — generateContent REST endpoint, inline_data
 * parts. Auth follows this repo's existing Google REST-API-key convention
 * (see lcyt-rtmp's GoogleSttAdapter / GOOGLE_STT_KEY) rather than a service
 * account — simplest path for a per-provider apiKey stored in ai_providers.
 */

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
   * @param {{ model: string, apiKey: string, apiUrl: string }} opts
   */
  constructor({ model, apiKey, apiUrl }) {
    this.model = model;
    this.apiKey = apiKey;
    this.apiUrl = (apiUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
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

    const url = `${this.apiUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google vision API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw new Error('Unexpected Google vision response format');
    return parseOutput(text, opts.outputMode);
  }
}
