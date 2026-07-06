import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { ModelsIcon } from './icons.jsx';

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
      icon={ModelsIcon}
      color="purple"
      title="AI models"
      description="Embedding model for fuzzy/semantic cue matching. More roles coming soon."
      status="partial"
      statusLabel="1 of 5 roles"
      headerAction={{ label: 'Open AI settings', href: '/ai' }}
    >
      <SetupItemRow
        name="Embedding provider"
        meta={
          session?.connected && provider
            ? `${PROVIDER_LABELS[provider] || provider} — used for fuzzy/semantic cue matching`
            : 'Used for fuzzy/semantic cue matching'
        }
      />
    </SetupCard>
  );
}
