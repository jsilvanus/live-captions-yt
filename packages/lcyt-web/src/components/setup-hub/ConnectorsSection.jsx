import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard } from './SetupCard.jsx';

/**
 * ConnectorsSection — API Connectors & Variables card. Backed by the
 * `lcyt-connectors` plugin (see docs/plans/plan_api_connectors_variables.md).
 * Full management (create/edit/delete connectors, requests, response
 * mappings, manual variables) lives on the dedicated /connectors page.
 */
export function ConnectorsSection() {
  const session = useSessionContext();
  const [count, setCount] = useState(null);

  const load = useCallback(async () => {
    if (!session?.connected || !session?.backendUrl) return;
    try {
      const token = session.getSessionToken?.();
      const r = await fetch(`${session.backendUrl}/connectors`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) {
        const data = await r.json();
        setCount(data.connectors?.length ?? 0);
      }
    } catch { /* ignore */ }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  return (
    <SetupCard
      icon="🔌"
      title="API connectors"
      description={
        session?.connected && count !== null
          ? `${count} connector${count === 1 ? '' : 's'} configured. Connect third-party services and expose their responses as {{name}} variables.`
          : 'Connect third-party services (calendars, ChMS, lighting consoles, etc.) and expose their responses as {{name}} variables.'
      }
      status="ready"
      action={{ label: 'Manage connectors', href: '/connectors' }}
    />
  );
}
