import { useState } from 'react';
import { useSessionContext } from '../contexts/SessionContext.jsx';
import { useUserAuth } from '../hooks/useUserAuth.js';
import { useProjectRequired } from '../hooks/useProjectRequired.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { LiveOverlay } from './ai-observability/LiveOverlay.jsx';
import { CapturesPanel } from './ai-observability/CapturesPanel.jsx';
import { useAiObservability } from './ai-observability/useAiObservability.js';

const ROLE_CODES = ['tracker', 'describer'];

function RoleStatusChip({ roleCode, hook }) {
  const s = hook.status[roleCode];
  const running = !!s?.running;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8,
      border: '1px solid var(--color-border)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: running ? '#3ddc84' : '#666', flexShrink: 0 }} />
      <strong style={{ fontSize: 12, textTransform: 'capitalize' }}>{roleCode}</strong>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
        {running ? 'running' : 'stopped'}
        {s?.lastError ? ` · ${s.lastError}` : ''}
      </span>
      {running ? (
        <button type="button" onClick={() => hook.actions.stopRole(roleCode)} disabled={hook.busy} style={{ fontSize: 11 }}>Stop</button>
      ) : (
        <button type="button" onClick={() => hook.actions.startRole(roleCode)} disabled={hook.busy} style={{ fontSize: 11 }}>Start</button>
      )}
    </div>
  );
}

function AiObservabilityContent() {
  useProjectRequired();
  const hook = useAiObservability();
  const [roleTab, setRoleTab] = useState('tracker');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 24, gap: 16, overflow: 'auto' }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>AI Observability</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
          Live overlay, capture history, and a prompt sandbox for the Tracker/Describer vision roles.
          Dev/admin only — see nothing production doesn't already compute; opening this page never
          increases inference sampling rate on its own.
        </p>
      </div>

      {!hook.connected ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Connect a project session to inspect its vision roles.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ROLE_CODES.map((code) => <RoleStatusChip key={code} roleCode={code} hook={hook} />)}
          </div>

          <LiveOverlay
            previewUrl={hook.previewUrl}
            trackerObjects={hook.trackerObjects}
            describerUpdate={hook.describerUpdate}
          />

          <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--color-border)' }}>
            {ROLE_CODES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setRoleTab(code)}
                style={{
                  fontSize: 13, fontWeight: roleTab === code ? 700 : 400, padding: '8px 4px', textTransform: 'capitalize',
                  background: 'transparent', border: 'none', borderBottom: `2px solid ${roleTab === code ? '#3b6fb0' : 'transparent'}`,
                  color: 'inherit', cursor: 'pointer',
                }}
              >
                {code}
              </button>
            ))}
          </div>

          <CapturesPanel hook={hook} roleCode={roleTab} />
        </>
      )}
    </div>
  );
}

export function AiObservabilityPage() {
  const session = useSessionContext();
  // Same fallback as AdminAiModelsPage.jsx — prefer the user-login backend
  // for the AdminKeyGate check, falling back to the connected-project
  // session so an admin who is logged in but has no project session
  // connected doesn't see a broken/empty backendUrl.
  const { user, backendUrl: authBackendUrl } = useUserAuth();
  const backendUrl = authBackendUrl || session?.backendUrl || '';

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AiObservabilityContent />
    </AdminKeyGate>
  );
}
