import { useSessionContext } from '../contexts/SessionContext.jsx';
import { useUserAuth } from '../hooks/useUserAuth.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { AdminTabShell } from './AdminTabShell.jsx';
import { McpAccessSection } from './setup-hub/McpAccessSection.jsx';

export function AdminAiModelsPage() {
  const session = useSessionContext();
  // Prefer the user-login backend (same source Team/Account use) — falling
  // back to the connected-project session avoids a broken/empty backendUrl
  // for an admin who is logged in but has no project session connected. Only
  // affects the AdminKeyGate check here — McpAccessSection below reads its
  // own project-scoped backendUrl independently.
  const { user, backendUrl: authBackendUrl } = useUserAuth();
  const backendUrl = authBackendUrl || session?.backendUrl || '';

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminTabShell active="ai-models">
        <div style={{ padding: 24, maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h2 style={{ margin: '0 0 8px' }}>MCP Access</h2>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
              Manage personal access tokens for MCP clients.
            </p>
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <McpAccessSection />
          </div>
        </div>
      </AdminTabShell>
    </AdminKeyGate>
  );
}
