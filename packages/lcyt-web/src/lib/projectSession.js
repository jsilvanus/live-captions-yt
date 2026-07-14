import { KEYS } from './storageKeys.js';

function getStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function normalizePersistedSessionConfig(cfg = {}) {
  const next = { ...cfg };
  // Legacy minimal-mode config stored apiKey/projectToken; the new project-scoped flow
  // uses projectId/projectAccessToken as the canonical fields and we keep the old ones as shims.
  if (!next.projectId && next.apiKey) next.projectId = next.apiKey;
  if (!next.projectAccessToken && next.projectToken) next.projectAccessToken = next.projectToken;
  if (next.projectId && !next.apiKey) next.apiKey = next.projectId;
  return next;
}

export function readPersistedSessionConfig(storage = getStorage()) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEYS.session.config);
    return raw ? normalizePersistedSessionConfig(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function savePersistedSessionConfig(cfg, storage = getStorage()) {
  if (!storage) return null;
  const normalized = normalizePersistedSessionConfig(cfg);
  storage.setItem(KEYS.session.config, JSON.stringify(normalized));
  return normalized;
}

export function hasProjectSessionConfig(cfg = {}) {
  if (!cfg?.backendUrl) return false;
  const hasProjectScopedCreds = Boolean(cfg?.projectId && cfg?.projectAccessToken);
  const hasLegacyCreds = Boolean(cfg?.apiKey);
  return hasProjectScopedCreds || hasLegacyCreds;
}

/**
 * Activate a project as the current caption session and navigate home —
 * shared by ProjectsPage's "Enter" button and TeamPage's Projects tab.
 */
export function activateProject(backendUrl, projectId, projectAccessToken, opts = {}) {
  try {
    const existing = readPersistedSessionConfig();
    const next = {
      ...existing,
      backendUrl,
      projectId,
      apiKey: projectId,
      projectAccessToken,
      ...(opts.projectRole ? { projectRole: opts.projectRole } : {}),
      ...(opts.streamKey ? { streamKey: opts.streamKey } : {}),
    };
    savePersistedSessionConfig(next);
  } catch {
    savePersistedSessionConfig({ backendUrl, projectId, apiKey: projectId, projectAccessToken });
  }
  window.location.href = '/';
}
