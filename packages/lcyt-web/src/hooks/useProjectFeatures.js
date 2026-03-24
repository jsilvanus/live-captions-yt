/**
 * useProjectFeatures — reads feature flags and member info for a specific project.
 *
 * Usage:
 *   const { features, featureConfig, hasFeature, myAccessLevel, myPermissions, loading } =
 *     useProjectFeatures(backendUrl, token, apiKey);
 */

import { useState, useEffect, useCallback } from 'react';

export function useProjectFeatures(backendUrl, token, apiKey) {
  const [features, setFeatures] = useState([]);   // [{ code, enabled, config, grantedAt }]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const featureSet = new Set(features.filter(f => f.enabled).map(f => f.code));

  const featureConfig = (code) => {
    const f = features.find(f => f.code === code);
    return f?.config ?? null;
  };

  const hasFeature = useCallback((code) => featureSet.has(code), [featureSet]);

  const load = useCallback(async () => {
    if (!backendUrl || !token || !apiKey) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(apiKey)}/features`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setFeatures(data.features || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token, apiKey]);

  useEffect(() => {
    load();
  }, [load]);

  const updateFeature = useCallback(async (code, enabled, config = null) => {
    const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(apiKey)}/features/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled, ...(config !== null ? { config } : {}) }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    setFeatures(prev => {
      const idx = prev.findIndex(f => f.code === code);
      if (idx === -1) return [...prev, data];
      return prev.map((f, i) => i === idx ? data : f);
    });
    return data;
  }, [backendUrl, token, apiKey]);

  return {
    features,
    featureSet,
    featureConfig,
    hasFeature,
    loading,
    error,
    reload: load,
    updateFeature,
  };
}
