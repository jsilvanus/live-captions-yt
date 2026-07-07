function makeAuthHeaders({ token, apiKey }) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apiKey) headers['X-Api-Key'] = apiKey;
  return headers;
}

async function requestJson(backendUrl, path, { token, apiKey, method = 'GET', body } = {}) {
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...makeAuthHeaders({ token, apiKey }) };
  const res = await fetch(`${backendUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function listMcpTokens({ backendUrl, token, apiKey }) {
  const data = await requestJson(backendUrl, '/ai/mcp-tokens', { token, apiKey });
  return data.tokens || [];
}

export async function createMcpToken({ backendUrl, token, apiKey, label, createdByName, active = true }) {
  return requestJson(backendUrl, '/ai/mcp-tokens', {
    token,
    apiKey,
    method: 'POST',
    body: { label, createdByName, active },
  });
}

export async function updateMcpToken({ backendUrl, token, apiKey, id, label, createdByName, active }) {
  return requestJson(backendUrl, `/ai/mcp-tokens/${id}`, {
    token,
    apiKey,
    method: 'PATCH',
    body: { label, createdByName, active },
  });
}

export async function deleteMcpToken({ backendUrl, token, apiKey, id }) {
  return requestJson(backendUrl, `/ai/mcp-tokens/${id}`, {
    token,
    apiKey,
    method: 'DELETE',
  });
}

export async function listAiModels({ backendUrl, token, apiKey }) {
  const data = await requestJson(backendUrl, '/ai/models', { token, apiKey });
  return data.models || [];
}

export async function createAiModel({ backendUrl, token, apiKey, roleCode = 'assistant', provider, modelName, apiUrl, apiKeyValue, enabled = true }) {
  return requestJson(backendUrl, '/ai/models', {
    token,
    apiKey,
    method: 'POST',
    body: { roleCode, provider, modelName, apiUrl, apiKeyValue, enabled },
  });
}

export async function updateAiModel({ backendUrl, token, apiKey, id, roleCode, provider, modelName, apiUrl, apiKeyValue, enabled }) {
  return requestJson(backendUrl, `/ai/models/${id}`, {
    token,
    apiKey,
    method: 'PATCH',
    body: { roleCode, provider, modelName, apiUrl, apiKeyValue, enabled },
  });
}

export async function deleteAiModel({ backendUrl, token, apiKey, id }) {
  return requestJson(backendUrl, `/ai/models/${id}`, {
    token,
    apiKey,
    method: 'DELETE',
  });
}
