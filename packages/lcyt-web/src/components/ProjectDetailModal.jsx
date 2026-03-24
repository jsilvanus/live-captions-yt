/**
 * ProjectDetailModal — project management modal with tabs:
 *   Settings | Members | Device Roles | Danger Zone
 */
import { useState, useEffect, useCallback } from 'react';
import { FeaturePicker } from './FeaturePicker';
import { MemberRow } from './MemberRow';
import { InviteMemberForm } from './InviteMemberForm';
import { DeviceRoleRow } from './DeviceRoleRow';
import { CreateDeviceRoleForm } from './CreateDeviceRoleForm';
import { useProjectFeatures } from '../hooks/useProjectFeatures';

const TABS = ['Settings', 'Members', 'Device roles', 'Danger zone'];

export function ProjectDetailModal({ project, backendUrl, token, onClose, onDeleted }) {
  const [tab, setTab] = useState('Settings');

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        width: '100%',
        maxWidth: 680,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ flex: 1, fontSize: 16, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
            {project.owner}
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', padding: '0 20px', marginTop: 12 }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                padding: '8px 12px',
                fontSize: 13,
                cursor: 'pointer',
                color: tab === t ? 'var(--color-primary)' : 'var(--color-text-muted)',
                fontWeight: tab === t ? 600 : 400,
                marginBottom: -1,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {tab === 'Settings' && (
            <SettingsTab project={project} backendUrl={backendUrl} token={token} />
          )}
          {tab === 'Members' && (
            <MembersTab project={project} backendUrl={backendUrl} token={token} />
          )}
          {tab === 'Device roles' && (
            <DeviceRolesTab project={project} backendUrl={backendUrl} token={token} />
          )}
          {tab === 'Danger zone' && (
            <DangerZoneTab project={project} backendUrl={backendUrl} token={token} onDeleted={onDeleted} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab({ project, backendUrl, token }) {
  const { features, featureSet, loading, error, updateFeature } = useProjectFeatures(backendUrl, token, project.key);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [localSet, setLocalSet] = useState(null);

  // Initialise localSet once features load
  useEffect(() => {
    if (features.length > 0 && localSet === null) {
      setLocalSet(new Set(features.filter(f => f.enabled).map(f => f.code)));
    }
  }, [features, localSet]);

  const displaySet = localSet ?? featureSet;

  async function handleSave() {
    if (!localSet) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Build delta: what changed vs server state
      const featureMap = {};
      const allCodes = new Set([...featureSet, ...localSet]);
      for (const code of allCodes) {
        const wasOn = featureSet.has(code);
        const isOn  = localSet.has(code);
        if (wasOn !== isOn) featureMap[code] = isOn;
      }
      if (Object.keys(featureMap).length > 0) {
        const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(project.key)}/features`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ features: featureMap }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      }
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 12 }}>
          Feature access
        </div>
        {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <FeaturePicker value={displaySet} onChange={setLocalSet} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {saveError && <span style={{ fontSize: 12, color: 'var(--color-error)' }}>{saveError}</span>}
        <button
          className="btn btn--primary btn--sm"
          onClick={handleSave}
          disabled={saving || !localSet}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ── Members tab ───────────────────────────────────────────────────────────────

function MembersTab({ project, backendUrl, token }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(project.key)}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setMembers(data.members || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token, project.key]);

  useEffect(() => { load(); }, [load]);

  const myMember = members.find(m => m.email === /* injected later */ null);
  const myLevel = project.myAccessLevel || 'member';

  async function handleRemove(userId) {
    if (!confirm('Remove this member from the project?')) return;
    try {
      const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(project.key)}/members/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setMembers(prev => prev.filter(m => m.userId !== userId));
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {members.map(m => (
          <MemberRow
            key={m.userId}
            member={m}
            currentUserAccessLevel={myLevel}
            onRemove={handleRemove}
          />
        ))}
        {members.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No members yet.</div>
        )}
      </div>
      {(myLevel === 'owner' || myLevel === 'admin') && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
            Invite by email
          </div>
          <InviteMemberForm
            backendUrl={backendUrl}
            token={token}
            apiKey={project.key}
            onInvited={() => load()}
          />
        </div>
      )}
    </div>
  );
}

// ── Device roles tab ──────────────────────────────────────────────────────────

function DeviceRolesTab({ project, backendUrl, token }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deviceCode, setDeviceCode] = useState(null);
  const [generatingCode, setGeneratingCode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, codeRes] = await Promise.all([
        fetch(`${backendUrl}/keys/${encodeURIComponent(project.key)}/device-roles`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${backendUrl}/keys/${encodeURIComponent(project.key)}/device-code`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const rolesData = await rolesRes.json();
      const codeData  = await codeRes.json();
      if (!rolesRes.ok) throw new Error(rolesData.error || `HTTP ${rolesRes.status}`);
      setRoles(rolesData.deviceRoles || []);
      setDeviceCode(codeData.deviceCode || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token, project.key]);

  useEffect(() => { load(); }, [load]);

  async function handleGenerateCode() {
    setGeneratingCode(true);
    try {
      const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(project.key)}/device-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setDeviceCode(data.deviceCode);
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingCode(false);
    }
  }

  if (loading) return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</div>}

      {/* Project device code */}
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '12px 16px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>
          Project device code
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
          Operators enter this 6-digit code first on the device login page to identify the project.
          Then they enter the role PIN to connect.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {deviceCode ? (
            <code style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--color-text)' }}>
              {deviceCode}
            </code>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Not set</span>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={handleGenerateCode}
            disabled={generatingCode}
            style={{ fontSize: 11 }}
          >
            {generatingCode ? '…' : deviceCode ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Device role list */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
          Device roles
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {roles.filter(r => r.active).map(role => (
            <DeviceRoleRow
              key={role.id}
              role={role}
              backendUrl={backendUrl}
              token={token}
              apiKey={project.key}
              onDeleted={id => setRoles(prev => prev.filter(r => r.id !== id))}
            />
          ))}
          {roles.filter(r => r.active).length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No device roles yet.</div>
          )}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
          Add device role
        </div>
        <CreateDeviceRoleForm
          backendUrl={backendUrl}
          token={token}
          apiKey={project.key}
          onCreated={role => setRoles(prev => [...prev, role])}
        />
      </div>
    </div>
  );
}

// ── Danger zone tab ───────────────────────────────────────────────────────────

function DangerZoneTab({ project, backendUrl, token, onDeleted, onClose }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  async function handleDelete() {
    if (!confirm(`Delete project "${project.owner}"? The API key will be revoked and all sessions will end.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(project.key)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onDeleted?.(project.key);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        border: '1px solid var(--color-error)',
        borderRadius: 8,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-error)' }}>Delete project</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Revokes the API key and removes all associated data. This cannot be undone.
        </div>
        {error && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</div>}
        <button
          className="btn btn--sm"
          onClick={handleDelete}
          disabled={deleting}
          style={{ alignSelf: 'flex-start', background: 'var(--color-error)', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer' }}
        >
          {deleting ? 'Deleting…' : 'Delete project'}
        </button>
      </div>
    </div>
  );
}
