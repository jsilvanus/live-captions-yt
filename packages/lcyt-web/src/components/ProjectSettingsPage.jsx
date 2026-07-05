/**
 * ProjectSettingsPage — routed project management screen with tabs:
 *   Summary | Features | Team | Device roles | Danger zone
 *
 * This is `ProjectDetailModal.jsx` un-nested into a full page. It's mounted
 * at two routes:
 *   - `/` (no :key param) — implicit key from the active session (the
 *     project summary view for whichever project is currently connected).
 *   - `/projects/:key` (explicit key) — reached from ProjectsPage's "Manage"
 *     button, to view/manage *any* of the user's projects, not just the
 *     active one.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRoute, Link } from 'wouter';
import { useUserAuth } from '../hooks/useUserAuth';
import { useSessionContext } from '../contexts/SessionContext';
import { FeaturePicker } from './FeaturePicker';
import { MemberRow } from './MemberRow';
import { InviteMemberForm } from './InviteMemberForm';
import { DeviceRoleRow } from './DeviceRoleRow';
import { CreateDeviceRoleForm } from './CreateDeviceRoleForm';
import { useProjectFeatures } from '../hooks/useProjectFeatures';

const TABS = ['Summary', 'Features', 'Team', 'Device roles', 'Danger zone'];

function maskKey(key) {
  if (!key || key.length < 8) return key;
  return key.slice(0, 8) + '••••••••••••••••••••••••••••';
}

// ── Summary tab ─────────────────────────────────────────────────────────────

function SummaryTab({ project, isActiveSession }) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isActiveSession && (
        <div style={{
          fontSize: 12, padding: '6px 10px', borderRadius: 6,
          background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
          color: 'var(--color-accent)',
        }}>
          This is your currently active project.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="account-page__info-row">
          <span className="account-page__info-label">API key</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
              {showKey ? project.key : maskKey(project.key)}
            </code>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowKey(v => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </span>
        </div>
        <div className="account-page__info-row">
          <span className="account-page__info-label">Access level</span>
          <span className="account-page__info-value">{project.myAccessLevel || 'owner'}</span>
        </div>
        <div className="account-page__info-row">
          <span className="account-page__info-label">Created</span>
          <span className="account-page__info-value">{new Date(project.createdAt).toLocaleDateString()}</span>
        </div>
        {project.expires && (
          <div className="account-page__info-row">
            <span className="account-page__info-label">Expires</span>
            <span className="account-page__info-value">{new Date(project.expires).toLocaleDateString()}</span>
          </div>
        )}
        {project.memberCount > 1 && (
          <div className="account-page__info-row">
            <span className="account-page__info-label">Members</span>
            <span className="account-page__info-value">{project.memberCount}</span>
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Quick links</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Link href="/setup"><a className="btn btn--ghost btn--sm">🧙 Setup</a></Link>
          <Link href="/assets"><a className="btn btn--ghost btn--sm">🗂 Assets</a></Link>
          <Link href="/broadcast"><a className="btn btn--ghost btn--sm">📡 Broadcast</a></Link>
          <Link href="/graphics/editor"><a className="btn btn--ghost btn--sm">🖼️ Graphics</a></Link>
          <Link href="/team"><a className="btn btn--ghost btn--sm">👥 Team</a></Link>
        </div>
      </div>
    </div>
  );
}

// ── Features tab (formerly "Settings") ───────────────────────────────────────

function FeaturesTab({ project, backendUrl, token }) {
  const { features, featureSet, loading, error, updateFeature } = useProjectFeatures(backendUrl, token, project.key);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [localSet, setLocalSet] = useState(null);

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
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
        <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving || !localSet}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ── Team tab (formerly "Members") ────────────────────────────────────────────

function TeamTab({ project, backendUrl, token }) {
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
          <MemberRow key={m.userId} member={m} currentUserAccessLevel={myLevel} onRemove={handleRemove} />
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
          <InviteMemberForm backendUrl={backendUrl} token={token} apiKey={project.key} onInvited={() => load()} />
        </div>
      )}
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
        Looking for organization-wide team management across multiple projects?{' '}
        <Link href="/team"><a>See the Team page</a></Link>.
      </p>
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

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 16px' }}>
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
          <button className="btn btn--ghost btn--sm" onClick={handleGenerateCode} disabled={generatingCode} style={{ fontSize: 11 }}>
            {generatingCode ? '…' : deviceCode ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
          Device roles
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {roles.filter(r => r.active).map(role => (
            <DeviceRoleRow key={role.id} role={role} backendUrl={backendUrl} token={token} apiKey={project.key}
              onDeleted={id => setRoles(prev => prev.filter(r => r.id !== id))} />
          ))}
          {roles.filter(r => r.active).length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No device roles yet.</div>
          )}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
          Add device role
        </div>
        <CreateDeviceRoleForm backendUrl={backendUrl} token={token} apiKey={project.key}
          onCreated={role => setRoles(prev => [...prev, role])} />
      </div>
    </div>
  );
}

// ── Danger zone tab ───────────────────────────────────────────────────────────

function DangerZoneTab({ project, backendUrl, token, onDeleted }) {
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
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ border: '1px solid var(--color-error)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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

// ── Page shell ────────────────────────────────────────────────────────────────

/**
 * @param {{ implicitKey?: boolean }} props - when true, always use the active
 *   session's apiKey rather than a route :key param (used when mounted at `/`).
 */
export function ProjectSettingsPage({ implicitKey = false } = {}) {
  const [, routeParams] = useRoute('/projects/:key');
  const { user, token, backendUrl, loading: authLoading } = useUserAuth();
  const session = useSessionContext();

  const effectiveKey = implicitKey ? session?.apiKey : (routeParams?.key || session?.apiKey);
  const isActiveSession = !!session?.connected && session?.apiKey === effectiveKey;

  const [tab, setTab] = useState('Summary');
  const [projects, setProjects] = useState(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token || !backendUrl) {
      setLoadingProjects(false);
      return;
    }
    setLoadingProjects(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/keys`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setProjects(data.keys || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingProjects(false);
    }
  }, [token, backendUrl]);

  useEffect(() => { load(); }, [load]);

  if (authLoading || loadingProjects) {
    return <div className="settings-page" style={{ padding: 24, color: 'var(--color-text-muted)' }}>Loading…</div>;
  }

  if (!user) {
    return (
      <div className="stub-page">
        <div className="stub-page__icon">📁</div>
        <div className="stub-page__title">Sign in to manage projects</div>
        <p className="stub-page__desc">
          Project settings require a user account. <Link href="/login"><a>Sign in</a></Link>.
        </p>
      </div>
    );
  }

  if (error) {
    return <div style={{ padding: 24, color: 'var(--color-error)' }}>{error}</div>;
  }

  const project = (projects || []).find(p => p.key === effectiveKey);

  if (!effectiveKey || !project) {
    return (
      <div className="stub-page">
        <div className="stub-page__icon">📁</div>
        <div className="stub-page__title">No project selected</div>
        <p className="stub-page__desc">
          Connect to a project, or pick one from <Link href="/projects"><a>Projects</a></Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-page project-settings-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px 0' }}>
        <h1 style={{ flex: 1, fontSize: 18, fontWeight: 600, margin: 0 }}>{project.owner}</h1>
      </div>
      <div className="settings-modal__tabs" style={{ padding: '0 20px', marginTop: 12 }}>
        {TABS.map(t => (
          <button
            key={t}
            className={`settings-tab${tab === t ? ' settings-tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'Summary'      && <SummaryTab project={project} isActiveSession={isActiveSession} />}
        {tab === 'Features'     && <FeaturesTab project={project} backendUrl={backendUrl} token={token} />}
        {tab === 'Team'         && <TeamTab project={project} backendUrl={backendUrl} token={token} />}
        {tab === 'Device roles' && <DeviceRolesTab project={project} backendUrl={backendUrl} token={token} />}
        {tab === 'Danger zone'  && (
          <DangerZoneTab
            project={project}
            backendUrl={backendUrl}
            token={token}
            onDeleted={() => { setProjects(prev => prev.filter(p => p.key !== project.key)); window.location.href = '/projects'; }}
          />
        )}
      </div>
    </div>
  );
}
