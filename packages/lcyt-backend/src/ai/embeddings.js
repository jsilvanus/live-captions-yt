/**
 * Embedding service — computes text embeddings via OpenAI-compatible APIs.
 *
 * Supports:
 *   - OpenAI embeddings API (text-embedding-3-small, text-embedding-ada-002)
 *   - Any OpenAI-compatible endpoint (LocalAI, Ollama, LiteLLM, etc.)
 *   - Server-level default config via environment variables
 *
 * Environment variables for server-level embedding config:
 *   EMBEDDING_API_URL    — Base URL (default: https://api.openai.com)
 *   EMBEDDING_API_KEY    — API key for the embedding provider
 *   EMBEDDING_MODEL      — Model name (default: text-embedding-3-small)
 */

/**
 * Compute embeddings for one or more texts.
 *
 * @param {string[]} texts — array of text strings to embed
 * @param {{ apiUrl?: string, apiKey?: string, model?: string }} opts
 * @returns {Promise<number[][]>} — array of embedding vectors
 */
export async function computeEmbeddings(texts, opts = {}) {
  const apiUrl = (opts.apiUrl || process.env.EMBEDDING_API_URL || 'https://api.openai.com').replace(/\/$/, '');
  const apiKey = opts.apiKey || process.env.EMBEDDING_API_KEY || '';
  const model = opts.model || process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

  if (!apiKey) {
    throw new Error('Embedding API key is not configured');
  }

  const url = `${apiUrl}/v1/embeddings`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  const body = JSON.stringify({
    input: texts,
    model,
  });

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Embedding API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Unexpected embedding API response format');
  }

  // Sort by index to ensure correct ordering
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
}

/**
 * Compute cosine similarity between two vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} — similarity score between -1 and 1
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Check if server-level embedding is available (env vars configured).
 * @returns {boolean}
 */
export function isServerEmbeddingAvailable() {
  return !!(process.env.EMBEDDING_API_KEY);
}
