import { OpenAiVisionAdapter } from './openai-vision.js';
import { GoogleVisionAdapter } from './google-vision.js';
import { AnthropicVisionAdapter } from './anthropic-vision.js';

const ADAPTERS = {
  openai: OpenAiVisionAdapter,
  google: GoogleVisionAdapter,
  anthropic: AnthropicVisionAdapter,
  // 'custom' providers are most often OpenAI-wire-compatible deployments
  // (LiteLLM, vLLM, LocalAI) — same default other ai-config provider modes
  // in this codebase already assume.
  custom: OpenAiVisionAdapter,
};

/**
 * @param {'openai'|'google'|'anthropic'|'custom'} vendor
 * @param {{ model: string, apiKey: string, apiUrl: string }} settings
 * @returns {{ analyse: Function }}
 */
export function createVisionAdapter(vendor, settings) {
  const Adapter = ADAPTERS[vendor];
  if (!Adapter) throw new Error(`No vision adapter for vendor '${vendor}'`);
  return new Adapter(settings);
}

export { OpenAiVisionAdapter, GoogleVisionAdapter, AnthropicVisionAdapter };
