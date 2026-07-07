import { useSessionContext } from '../contexts/SessionContext.jsx';
import { useUserAuth } from '../hooks/useUserAuth.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { AdminTabShell } from './AdminTabShell.jsx';
import { AiModelsSection } from './setup-hub/AiModelsSection.jsx';
import { McpAccessSection } from './setup-hub/McpAccessSection.jsx';

export function AdminAiModelsPage() {
  const session = useSessionContext();
  const backendUrl = session?.backendUrl || '';
  const { user } = useUserAuth();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminTabShell active="ai-models">
        <div style={{ padding: 24, maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h2 style={{ margin: '0 0 8px' }}>AI Models & MCP Access</h2>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
              Manage role-based AI model defaults for this project and personal access tokens for MCP clients.
            </p>
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <McpAccessSection />
            <AiModelsSection />
          </div>
        </div>
      </AdminTabShell>
    </AdminKeyGate>
  );
}
