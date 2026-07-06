import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard } from './SetupCard.jsx';

const PROVIDER_LABELS = { none: 'Disabled', server: 'Server-provided', openai: 'OpenAI', custom: 'Custom API' };

/**
 * AiModelsSection — shows the one real AI/embedding config slot that exists
 * today (`GET /ai/config`, same data as AiSettingsPage at /ai). The planned
 * role split (tracker / describer / planner assistant / production assistant
 * / graphics assistant — see docs/plans/plan_ai_roles_framework.md) has no
 * backend support yet and is labeled "Coming soon".
 */
export function AiModelsSection() {
  const session = useSessionContext();
  const [provider, setProvider] = useState(null);

  const load = useCallback(async () => {
    if (!session?.connected || !session?.backendUrl) return;
    try {
      const token = session.getSessionToken?.();
      const r = await fetch(`${session.backendUrl}/ai/config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) {
        const data = await r.json();
        setProvider(data.config?.embeddingProvider || 'none');
      }
    } catch { /* ignore */ }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  return (
    <SetupCard
      id="ai-models"
      icon="🤖"
      title="AI models"
      description={
        session?.connected && provider
          ? `Embedding provider: ${PROVIDER_LABELS[provider] || provider}. Used for fuzzy/semantic cue matching.`
          : 'Embedding model configuration for fuzzy/semantic cue matching.'
      }
      status="partial"
      statusLabel="1 of 5 roles"
      action={{ label: 'Open AI settings', href: '/ai' }}
    >
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
        Today there is a single embedding-provider slot. A five-role split —
        Tracker, Describer, Planner Assistant, Production Assistant, and
        <strong> Graphics Assistant</strong> (DSK template generation) — is
        <strong> coming soon</strong> — it isn't backed by the server yet.
      </p>
    </SetupCard>
  );
}
