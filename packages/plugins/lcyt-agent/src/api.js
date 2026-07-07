/**
 * lcyt-agent plugin entry point — AI Agent.
 *
 * The Agent plugin is the central AI service for LCYT. It owns:
 * - AI configuration (embedding provider, model, API keys per user)
 * - Embedding computation via OpenAI-compatible APIs
 * - Context window management (STT transcripts + explanation metacodes)
 * - Video/image inference (planned: vision-capable LLM)
 * - Event cues (planned: cue[events]:something happens)
 *
 * Other plugins (e.g. lcyt-cues CueEngine) delegate embedding calls
 * to the Agent rather than calling the embedding API directly.
 *
 * Usage in lcyt-backend/src/server.js:
 *
 *   import { initAgent, createAgentRouter, createAiRouter } from 'lcyt-agent';
 *
 *   const { agent } = await initAgent(db);
 *   app.use('/agent', createAgentRouter(db, auth, agent));
 *   app.use('/ai', createAiRouter(db, auth));
 *
 *   // Wire embedding fn into CueEngine:
 *   cueEngine.setEmbeddingFn((texts, opts) => agent.computeEmbeddings(texts));
 *   cueEngine.setAiConfigFn((apiKey) => agent.getAiConfig(apiKey));
 */

export { AgentEngine } from './agent-engine.js';
export { createAgentRouter } from './routes/agent.js';
export { createAiRouter } from './routes/ai.js';
export { createAdminAiProvidersRouter } from './routes/ai-providers-admin.js';
export { createProjectAiProvidersRouter } from './routes/ai-providers-project.js';
export { createRolesRouter } from './routes/roles.js';
export { runMigrations } from './db.js';

// AI Roles Framework (plan/ai_roles_framework): role catalog + per-project config
export {
  runAiRolesMigrations, BUILTIN_ROLES, RUNTIME_KINDS,
  listRoles, getRole, getRoleConfig, setRoleConfig, defaultRoleConfig, effectiveMode,
} from './ai-roles.js';

// AI model registry (plan/ai_model_registry): providers, model catalogs, grants
export {
  runProviderRegistryMigrations,
  createProvider, updateProvider, deleteProvider, getProvider,
  maskProvider, listSiteProviders, listVisibleProviders, isProviderVisible,
  setGrant, listGrants,
  listProviderModels, addManualModel, updateModel, deleteModel,
  PROVIDER_KINDS, PROVIDER_VENDORS,
} from './provider-registry.js';
export { discoverProvider, inferCapabilities, upsertDiscoveredModels } from './discovery.js';

// Re-export AI config and embedding utilities so the backend can use them
export {
  runAiMigrations,
  getAiConfig,
  getAiConfigRaw,
  setAiConfig,
  VALID_PROVIDERS,
} from './ai-config.js';

export {
  computeEmbeddings,
  cosineSimilarity,
  isServerEmbeddingAvailable,
} from './embeddings.js';

/**
 * Run DB migrations and create the AgentEngine instance.
 * Call once at backend startup before mounting any routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]
 * @returns {Promise<{ agent: import('./agent-engine.js').AgentEngine }>}
 */
export async function initAgent(db, opts = {}) {
  const { runMigrations } = await import('./db.js');
  runMigrations(db);

  // AI config table migrations (embedding provider config per user)
  const { runAiMigrations } = await import('./ai-config.js');
  runAiMigrations(db);

  // AI model registry migrations (ai_providers / ai_provider_models / ai_provider_grants)
  const { runProviderRegistryMigrations } = await import('./provider-registry.js');
  runProviderRegistryMigrations(db);

  // AI Roles Framework migrations (ai_roles catalog seed + project_ai_role_configs)
  const { runAiRolesMigrations } = await import('./ai-roles.js');
  runAiRolesMigrations(db);

  const { AgentEngine } = await import('./agent-engine.js');
  const agent = new AgentEngine(db, opts);

  // Small handle for the provider registry. The bridge manager (from
  // lcyt-production) is injected by the composition root (server.js) after
  // both plugins are initialized — same setter-injection convention as
  // cueEngine.setAgentEvaluateFn().
  const registryModule = await import('./provider-registry.js');
  const discoveryModule = await import('./discovery.js');
  const providerRegistry = {
    _bridgeManager: null,
    setBridgeManager(bridgeManager) { this._bridgeManager = bridgeManager; },
    getBridgeManager() { return this._bridgeManager; },
    getProvider: (id) => registryModule.getProvider(db, id),
    listVisibleProviders: (apiKey) => registryModule.listVisibleProviders(db, apiKey),
    listProviderModels: (providerId) => registryModule.listProviderModels(db, providerId),
    discoverProvider(provider) {
      return discoveryModule.discoverProvider(db, provider, { bridgeManager: this._bridgeManager });
    },
  };

  return { agent, providerRegistry };
}
