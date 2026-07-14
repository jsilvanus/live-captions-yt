import { useCallback, useEffect, useRef, useState } from 'react';
import { useUserAuth } from '../hooks/useUserAuth.js';
import { FeaturePicker } from './FeaturePicker.jsx';
import { Dialog } from './Dialog.jsx';
import { ProjectRow, ProjectThumbnail } from './ProjectsPage.jsx';
import { activateProject } from '../lib/projectSession.js';
import { colorFromString } from '../lib/avatar.js';
import { Avatar, RoleBadge, ROLE_LABELS } from './PersonBadge.jsx';

const ROLE_ORDER = ['owner', 'admin', 'editor', 'operator', 'viewer'];

function authHeaders(token, extra = {}) {
  return { ...extra, Authorization: `Bearer ${token}` };
}

// ─── Org picker ────────────────────────────────────────────────────────────

function OrgPicker({ orgs, activeOrgId, onSelect, onCreate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = orgs.find(o => o.id === activeOrgId);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
      >
        {active && (
          <span style={{
            width: 22, height: 22, borderRadius: 6, background: colorFromString(active.slug || active.name),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {(active.name || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
          {active ? active.name : 'Select team'}
        </span>
        <span style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, minWidth: 240, zIndex: 20,
          background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)',
          borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}>
          {orgs.length === 0 && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>No teams yet.</div>
          )}
          {orgs.map(org => (
            <button
              key={org.id}
              type="button"
              onClick={() => { onSelect(org.id); setOpen(false); }}
              style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '9px 14px',
                background: org.id === activeOrgId ? 'var(--color-primary-tint, rgba(46,95,163,0.08))' : 'transparent',
                border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{org.name}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{ROLE_LABELS[org.role] || org.role}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => { onCreate(); setOpen(false); }}
            style={{
              display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '10px 14px',
              borderTop: '1px solid var(--color-border)', background: 'transparent', border: 'none',
              borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--color-border)',
              cursor: 'pointer', fontSize: 13, color: 'var(--color-primary)', fontWeight: 500,
            }}
          >
            + New team
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Create team dialog ─────────────────────────────────────────────────────

function CreateTeamDialog({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      await onCreate(trimmed);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog title="New team" onClose={onClose} footer={
      <>
        <button className="btn btn--ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" type="submit" form="create-team-form" disabled={loading}>
          {loading ? 'Creating…' : 'Create →'}
        </button>
      </>
    }>
      <form id="create-team-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Create a new team workspace.</p>
        <div className="settings-field">
          <label className="settings-field__label">Team name</label>
          <input
            className="settings-field__input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Acme Media"
            autoFocus
          />
          {/* No manual slug field: the real API auto-generates a unique slug from the name. */}
        </div>
        {error && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</div>}
      </form>
    </Dialog>
  );
}

// ─── Invite member dialog ───────────────────────────────────────────────────

function InviteMemberDialog({ orgName, onClose, onInvite }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onInvite(email.trim(), role);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog title={`Invite to ${orgName}`} onClose={onClose} footer={
      <>
        <button className="btn btn--ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" type="submit" form="invite-member-form" disabled={loading}>
          {loading ? 'Inviting…' : 'Send invite'}
        </button>
      </>
    }>
      <form id="invite-member-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>They'll need an existing account with this email.</p>
        <div className="settings-field">
          <label className="settings-field__label">Email address</label>
          <input
            className="settings-field__input"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            autoFocus
          />
        </div>
        <div className="settings-field">
          <label className="settings-field__label">Role</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ROLE_ORDER.filter(r => r !== 'owner').map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                style={{
                  flex: '1 1 auto', padding: '0.45rem 0.6rem', borderRadius: 8, fontSize: 12.5, fontWeight: 500,
                  border: `1.5px solid ${role === r ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: role === r ? 'var(--color-primary-tint, rgba(46,95,163,0.1))' : 'transparent',
                  color: role === r ? 'var(--color-primary)' : 'var(--color-text-muted)',
                }}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        {error && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</div>}
      </form>
    </Dialog>
  );
}

// ─── Member management dialog ───────────────────────────────────────────────

function MemberManagementDialog({ member, canManage, onClose, onSave, onRemove }) {
  const [role, setRole] = useState(member.role);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isOwner = member.role === 'owner';

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await onSave(member, role);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!window.confirm(`Remove ${member.name || member.email} from the team?`)) return;
    try {
      await onRemove(member);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Dialog title="Member" onClose={onClose} footer={
      <>
        <button className="btn btn--ghost btn--danger" type="button" onClick={handleRemove} disabled={isOwner || !canManage}
          title={isOwner ? 'Cannot remove the owner' : undefined}>
          Remove from team
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn--ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" type="button" onClick={handleSave} disabled={saving || !canManage || isOwner}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </>
    }>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <Avatar name={member.name} email={member.email} size={44} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{member.name || member.email}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{member.email}</div>
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-field__label">Role</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ROLE_ORDER.map(r => (
            <button
              key={r}
              type="button"
              disabled={!canManage || isOwner}
              onClick={() => setRole(r)}
              style={{
                flex: '1 1 auto', padding: '0.4rem 0.55rem', borderRadius: 8, fontSize: 12, fontWeight: 500,
                border: `1.5px solid ${role === r ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: role === r ? 'var(--color-primary-tint, rgba(46,95,163,0.1))' : 'transparent',
                color: role === r ? 'var(--color-primary)' : 'var(--color-text-muted)',
                opacity: (!canManage || isOwner) ? 0.6 : 1,
              }}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 10 }}>{error}</div>}
    </Dialog>
  );
}

// ─── Members tab ─────────────────────────────────────────────────────────────

function MembersTab({ org, members, canManage, onChangeRole, onRemoveMember }) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [selectedMember, setSelectedMember] = useState(null);

  const filtered = members.filter(m => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || (m.name || '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
    const matchesRole = roleFilter === 'All' || m.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', flexWrap: 'wrap' }}>
        <input
          className="settings-field__input"
          placeholder="Search members…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 280, flex: 1 }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['All', ...ROLE_ORDER].map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              style={{
                padding: '0.28rem 0.7rem', borderRadius: 20, fontSize: 12, fontWeight: 500,
                border: `1.5px solid ${roleFilter === r ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: roleFilter === r ? 'var(--color-primary-tint, rgba(46,95,163,0.1))' : 'transparent',
                color: roleFilter === r ? 'var(--color-primary)' : 'var(--color-text-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              {r === 'All' ? 'All' : ROLE_LABELS[r]}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{members.length} members</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, paddingTop: 8 }}>
        {filtered.map(member => (
          <div
            key={member.userId}
            onClick={() => setSelectedMember(member)}
            role="button"
            tabIndex={0}
            style={{
              background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', borderRadius: 12,
              padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 14, cursor: 'pointer',
            }}
          >
            <Avatar name={member.name} email={member.email} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {member.name || member.email}
                </span>
                <RoleBadge role={member.role} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {member.email}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--color-text-muted)' }}>
                {typeof member.projectCount === 'number' && <span>{member.projectCount} projects</span>}
                {member.joinedAt && <span>{new Date(member.joinedAt).toLocaleDateString()}</span>}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', gridColumn: '1 / -1' }}>No members match.</div>
        )}
      </div>

      {selectedMember && (
        <MemberManagementDialog
          member={selectedMember}
          canManage={canManage}
          onClose={() => setSelectedMember(null)}
          onSave={onChangeRole}
          onRemove={onRemoveMember}
        />
      )}
    </div>
  );
}

// ─── Projects tab ────────────────────────────────────────────────────────────

function ProjectsTab({ projects, backendUrl }) {
  return (
    <div style={{ paddingTop: 8 }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 14 }}>
        Team Projects
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {projects.map(project => (
          <ProjectRow
            key={project.key}
            project={project}
            onUse={() => handleUseProject(project)}
            onManage={() => window.location.assign(`/projects/${project.key}`)}
          />
        ))}
        {projects.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No projects assigned to this team yet.</div>
        )}
      </div>
    </div>
  );
}

// ─── General Setup tab (scoped to existing feature-flag defaults) ──────────

function SetupTab({ features, loading, saving, error, onChange, onSave }) {
  return (
    <div style={{ paddingTop: 8, maxWidth: 680 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24, padding: '16px 20px',
        background: 'var(--color-primary-tint, rgba(46,95,163,0.08))', border: '1.5px solid var(--color-border)', borderRadius: 10,
      }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', margin: '0 0 3px' }}>Team defaults</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
            These feature defaults are saved for the team. They don't change any project on their own — this is the
            starting point for projects created under this team.
          </p>
        </div>
      </div>
      <div style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Feature defaults</p>
        </div>
        <div style={{ padding: 16 }}>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading defaults…</div>
          ) : (
            <FeaturePicker value={features} onChange={onChange} />
          )}
          {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn btn--primary btn--sm" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save defaults'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function TeamPage() {
  const { user, token, backendUrl, loading: authLoading, requestProjectAccessToken } = useUserAuth();
  const [orgs, setOrgs] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState(null);
  const [activeOrg, setActiveOrg] = useState(null);
  const [activeRole, setActiveRole] = useState(null);
  const [members, setMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [features, setFeatures] = useState(new Set());
  const [tab, setTab] = useState('members');
  const [loading, setLoading] = useState(false);
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [featuresSaving, setFeaturesSaving] = useState(false);
  const [featuresError, setFeaturesError] = useState('');
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      window.location.href = '/login';
    }
  }, [authLoading, user]);

  const loadOrgs = useCallback(async () => {
    if (!token || !backendUrl) return;
    setError('');
    try {
      const res = await fetch(`${backendUrl}/orgs`, { headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load teams');
      const list = data.organizations || [];
      setOrgs(list);
      setActiveOrgId(prev => (prev && list.some(o => o.id === prev)) ? prev : (list[0]?.id ?? null));
    } catch (err) {
      setError(err.message);
    }
  }, [backendUrl, token]);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const loadOrgDetail = useCallback(async () => {
    if (!activeOrgId || !token || !backendUrl) {
      setActiveOrg(null);
      setActiveRole(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [orgRes, membersRes, projectsRes] = await Promise.all([
        fetch(`${backendUrl}/orgs/${activeOrgId}`, { headers: authHeaders(token) }),
        fetch(`${backendUrl}/orgs/${activeOrgId}/members`, { headers: authHeaders(token) }),
        fetch(`${backendUrl}/orgs/${activeOrgId}/projects`, { headers: authHeaders(token) }),
      ]);
      const orgData = await orgRes.json();
      const membersData = await membersRes.json();
      const projectsData = await projectsRes.json();
      if (!orgRes.ok) throw new Error(orgData.error || 'Could not load team');
      setActiveOrg(orgData.organization || null);
      setActiveRole(orgData.role || null);
      setMembers(membersData.members || []);
      setProjects(projectsData.projects || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, backendUrl, token]);

  useEffect(() => { loadOrgDetail(); }, [loadOrgDetail]);

  const canManage = activeRole === 'owner' || activeRole === 'admin';

  const loadFeatures = useCallback(async () => {
    if (!activeOrgId || !token || !backendUrl || tab !== 'setup') return;
    setFeaturesLoading(true);
    setFeaturesError('');
    try {
      const res = await fetch(`${backendUrl}/orgs/${activeOrgId}/features`, { headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load team defaults');
      setFeatures(new Set(data.features || []));
    } catch (err) {
      setFeaturesError(err.message);
    } finally {
      setFeaturesLoading(false);
    }
  }, [activeOrgId, backendUrl, tab, token]);

  useEffect(() => { loadFeatures(); }, [loadFeatures]);

  // Reset to a tab the current role can see whenever the active team changes.
  useEffect(() => {
    if (tab === 'setup' && !canManage) setTab('members');
  }, [canManage, tab]);

  async function handleUseProject(project) {
    if (!backendUrl || !token) return;
    try {
      if (typeof requestProjectAccessToken === 'function') {
        const data = await requestProjectAccessToken(project.key);
        activateProject(backendUrl, project.key, data.projectAccessToken, {
          projectRole: data.projectRole || null,
        });
        return;
      }
      activateProject(backendUrl, project.key, null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateTeam(name) {
    const res = await fetch(`${backendUrl}/orgs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Team creation failed');
    await loadOrgs();
    setActiveOrgId(data.organization.id);
  }

  async function handleInvite(email, role) {
    const res = await fetch(`${backendUrl}/orgs/${activeOrgId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invite failed');
    await loadOrgDetail();
  }

  async function handleChangeRole(member, role) {
    const res = await fetch(`${backendUrl}/orgs/${activeOrgId}/members/${member.userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Role update failed');
    await loadOrgDetail();
  }

  async function handleRemoveMember(member) {
    const res = await fetch(`${backendUrl}/orgs/${activeOrgId}/members/${member.userId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Remove failed');
    await loadOrgDetail();
  }

  async function handleSaveFeatures() {
    setFeaturesSaving(true);
    setFeaturesError('');
    try {
      const res = await fetch(`${backendUrl}/orgs/${activeOrgId}/features`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ features: [...features] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save defaults');
      setFeatures(new Set(data.features || []));
    } catch (err) {
      setFeaturesError(err.message);
    } finally {
      setFeaturesSaving(false);
    }
  }

  if (authLoading) return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</div>;
  if (!user) return null;

  const TABS = canManage
    ? [['members', 'Members'], ['projects', 'Projects'], ['setup', 'General Setup']]
    : [['members', 'Members'], ['projects', 'Projects']];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '20px 32px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--color-border)' }}>
        <OrgPicker orgs={orgs} activeOrgId={activeOrgId} onSelect={setActiveOrgId} onCreate={() => setShowCreateTeam(true)} />
        <div style={{ flex: 1 }} />
        {activeOrg && (
          <button className="btn btn--ghost" onClick={() => setShowInvite(true)}>Invite member</button>
        )}
        <button className="btn btn--primary" onClick={() => setShowCreateTeam(true)}>+ New team</button>
      </div>

      <div style={{ display: 'flex', gap: 0, padding: '0 32px', borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '0.55rem 1.1rem', fontSize: 13, fontWeight: 500, background: 'none', border: 'none',
              borderBottom: `2.5px solid ${tab === id ? 'var(--color-primary)' : 'transparent'}`,
              color: tab === id ? 'var(--color-text)' : 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: '0 32px 32px', flex: 1, overflowY: 'auto' }}>
        {error && <div style={{ color: 'var(--color-error)', fontSize: 13, marginTop: 12 }}>{error}</div>}
        {loading && !activeOrg ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 12 }}>Loading team…</div>
        ) : !activeOrg ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 12 }}>
            {orgs.length === 0 ? "You're not on a team yet — create one to get started." : 'Select a team.'}
          </div>
        ) : (
          <>
            {tab === 'members' && (
              <MembersTab org={activeOrg} members={members} canManage={canManage} onChangeRole={handleChangeRole} onRemoveMember={handleRemoveMember} />
            )}
            {tab === 'projects' && <ProjectsTab projects={projects} backendUrl={backendUrl} />}
            {tab === 'setup' && canManage && (
              <SetupTab
                features={features}
                loading={featuresLoading}
                saving={featuresSaving}
                error={featuresError}
                onChange={setFeatures}
                onSave={handleSaveFeatures}
              />
            )}
          </>
        )}
      </div>

      {showCreateTeam && (
        <CreateTeamDialog onClose={() => setShowCreateTeam(false)} onCreate={handleCreateTeam} />
      )}
      {showInvite && activeOrg && (
        <InviteMemberDialog orgName={activeOrg.name} onClose={() => setShowInvite(false)} onInvite={handleInvite} />
      )}
    </div>
  );
}
