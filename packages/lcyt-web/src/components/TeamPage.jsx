import { useCallback, useEffect, useMemo, useState } from 'react';
import { FeaturePicker } from './FeaturePicker.jsx';
import { useUserAuth } from '../hooks/useUserAuth.js';

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  operator: 'Operator',
  viewer: 'Viewer',
};

function authHeaders(token, extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`,
  };
}

function TeamList({ teams, selectedTeamId, onSelect, onCreateToggle, creatingTeam, onCreateTeam, onTeamNameChange, teamName, createError, createLoading }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Teams</div>
        <button className="btn btn--primary btn--sm" onClick={onCreateToggle}>
          New team
        </button>
      </div>

      {creatingTeam && (
        <form
          onSubmit={onCreateTeam}
          style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface)' }}
        >
          <input
            className="settings-field__input"
            value={teamName}
            onChange={onTeamNameChange}
            placeholder="Team name"
            autoFocus
          />
          {createError && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{createError}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => onCreateToggle(false)}>Cancel</button>
            <button className="btn btn--primary btn--sm" type="submit" disabled={createLoading}>
              {createLoading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {teams.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No teams yet.</div>}
        {teams.map(team => (
          <button
            key={team.id}
            type="button"
            onClick={() => onSelect(team.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${selectedTeamId === team.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: selectedTeamId === team.id ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'var(--color-surface)',
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{team.name}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{team.slug}</div>
            <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
              <span>{team.memberCount} members</span>
              <span>·</span>
              <span>{team.projectCount} projects</span>
            </div>
            <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>{ROLE_LABELS[team.role] || team.role}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TeamDetail({ team, loading, error, onRefresh, backendUrl, token }) {
  const [members, setMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [featureSet, setFeatureSet] = useState(new Set());
  const [featureLoading, setFeatureLoading] = useState(false);
  const [featureSaving, setFeatureSaving] = useState(false);
  const [featureError, setFeatureError] = useState('');

  const loadMembers = useCallback(async () => {
    const res = await fetch(`${backendUrl}/orgs/${team.id}/members`, { headers: authHeaders(token) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load members');
    setMembers(data.members || []);
  }, [backendUrl, team?.id, token]);

  const loadProjects = useCallback(async () => {
    const res = await fetch(`${backendUrl}/orgs/${team.id}/projects`, { headers: authHeaders(token) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load projects');
    setProjects(data.projects || []);
  }, [backendUrl, team?.id, token]);

  const loadFeatures = useCallback(async () => {
    setFeatureLoading(true);
    setFeatureError('');
    try {
      const res = await fetch(`${backendUrl}/orgs/${team.id}/features`, { headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load team defaults');
      setFeatureSet(new Set(data.features || []));
    } catch (err) {
      setFeatureError(err.message);
    } finally {
      setFeatureLoading(false);
    }
  }, [backendUrl, team?.id, token]);

  useEffect(() => {
    if (!team?.id) return;
    loadMembers().catch(() => {});
    loadProjects().catch(() => {});
    loadFeatures();
  }, [team?.id, loadMembers, loadProjects, loadFeatures]);

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteError('');
    try {
      const res = await fetch(`${backendUrl}/orgs/${team.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed');
      setInviteEmail('');
      setInviteRole('viewer');
      await loadMembers();
      onRefresh();
    } catch (err) {
      setInviteError(err.message);
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRemoveMember(userId) {
    if (!window.confirm('Remove this team member?')) return;
    try {
      const res = await fetch(`${backendUrl}/orgs/${team.id}/members/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Remove failed');
      await loadMembers();
      onRefresh();
    } catch (err) {
      setInviteError(err.message);
    }
  }

  async function handleChangeRole(member, role) {
    try {
      const res = await fetch(`${backendUrl}/orgs/${team.id}/members/${member.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Role update failed');
      await loadMembers();
      onRefresh();
    } catch (err) {
      setInviteError(err.message);
    }
  }

  async function handleAddProject(e) {
    e.preventDefault();
    if (!projectKey.trim()) return;
    setProjectLoading(true);
    setProjectError('');
    try {
      const res = await fetch(`${backendUrl}/keys/${encodeURIComponent(projectKey.trim())}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ orgId: team.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Project assignment failed');
      setProjectKey('');
      await loadProjects();
      onRefresh();
    } catch (err) {
      setProjectError(err.message);
    } finally {
      setProjectLoading(false);
    }
  }

  async function handleRemoveProject(projectKeyValue) {
    if (!window.confirm('Remove this project from the team?')) return;
    try {
      const res = await fetch(`${backendUrl}/keys/${encodeURIComponent(projectKeyValue)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ orgId: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Project update failed');
      await loadProjects();
      onRefresh();
    } catch (err) {
      setProjectError(err.message);
    }
  }

  async function handleSaveDefaults() {
    setFeatureSaving(true);
    setFeatureError('');
    try {
      const res = await fetch(`${backendUrl}/orgs/${team.id}/features`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ features: [...featureSet] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save defaults');
      setFeatureSet(new Set(data.features || []));
    } catch (err) {
      setFeatureError(err.message);
    } finally {
      setFeatureSaving(false);
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading team…</div>;
  }

  if (!team) {
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Select a team to manage members, projects, and defaults.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{team.name}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{team.slug}</div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onRefresh}>Refresh</button>
      </div>

      {error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Members</div>
        {inviteError && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{inviteError}</div>}
        <form onSubmit={handleInvite} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="settings-field__input"
            type="email"
            placeholder="Invite by email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            style={{ minWidth: 220, flex: 1 }}
          />
          <select className="settings-field__input" value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ width: 140 }}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button className="btn btn--primary btn--sm" type="submit" disabled={inviteLoading}>
            {inviteLoading ? 'Inviting…' : 'Invite'}
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map(member => (
            <div key={member.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{member.name || member.email}</div>
                {member.name && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{member.email}</div>}
              </div>
              <select className="settings-field__input" value={member.role} onChange={e => handleChangeRole(member, e.target.value)} style={{ width: 120 }}>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <button className="btn btn--ghost btn--sm" onClick={() => handleRemoveMember(member.userId)}>Remove</button>
            </div>
          ))}
          {members.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No members yet.</div>}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Projects</div>
        {projectError && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{projectError}</div>}
        <form onSubmit={handleAddProject} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="settings-field__input"
            placeholder="Project key"
            value={projectKey}
            onChange={e => setProjectKey(e.target.value)}
            style={{ minWidth: 220, flex: 1 }}
          />
          <button className="btn btn--primary btn--sm" type="submit" disabled={projectLoading}>
            {projectLoading ? 'Adding…' : 'Add project'}
          </button>
        </form>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {projects.map(project => (
            <div key={project.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{project.owner}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{project.key}</div>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => handleRemoveProject(project.key)}>Remove</button>
            </div>
          ))}
          {projects.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No projects assigned to this team yet.</div>}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Team defaults</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>These defaults are applied to projects that belong to this team.</div>
        {featureError && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{featureError}</div>}
        {featureLoading ? <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading defaults…</div> : <FeaturePicker value={featureSet} onChange={setFeatureSet} />}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn--primary btn--sm" onClick={handleSaveDefaults} disabled={featureSaving}>
            {featureSaving ? 'Saving…' : 'Save defaults'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeamPage() {
  const { user, token, backendUrl, loading: authLoading } = useUserAuth();
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [error, setError] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [createError, setCreateError] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      window.location.href = '/login';
    }
  }, [authLoading, user]);

  const loadTeams = useCallback(async () => {
    if (!token || !backendUrl) return;
    setLoadingTeams(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl}/orgs`, { headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load teams');
      const nextTeams = data.organizations || [];
      setTeams(nextTeams);
      if (nextTeams.length > 0 && !nextTeams.some(team => team.id === selectedTeamId)) {
        setSelectedTeamId(nextTeams[0].id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingTeams(false);
    }
  }, [backendUrl, selectedTeamId, token]);

  useEffect(() => {
    if (!token || !backendUrl) return;
    loadTeams();
  }, [backendUrl, token, loadTeams]);

  useEffect(() => {
    if (!selectedTeamId || !token || !backendUrl) {
      setSelectedTeam(null);
      return;
    }
    let ignore = false;
    (async () => {
      setLoadingTeam(true);
      setError('');
      try {
        const res = await fetch(`${backendUrl}/orgs/${selectedTeamId}`, { headers: authHeaders(token) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load team');
        if (!ignore) {
          setSelectedTeam(data.organization || null);
        }
      } catch (err) {
        if (!ignore) setError(err.message);
      } finally {
        if (!ignore) setLoadingTeam(false);
      }
    })();
    return () => { ignore = true; };
  }, [backendUrl, selectedTeamId, token]);

  async function handleCreateTeam(e) {
    e.preventDefault();
    const trimmed = teamName.trim();
    if (!trimmed) return;
    setCreateLoading(true);
    setCreateError('');
    try {
      const res = await fetch(`${backendUrl}/orgs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Team creation failed');
      setTeamName('');
      setCreatingTeam(false);
      await loadTeams();
      setSelectedTeamId(data.organization.id);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  }

  const selectedTeamDisplay = useMemo(() => {
    if (!selectedTeam) return null;
    return { ...selectedTeam, role: teams.find(team => team.id === selectedTeam.id)?.role || selectedTeam.role };
  }, [selectedTeam, teams]);

  if (authLoading) {
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</div>;
  }

  if (!user) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Teams</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 13 }}>Create teams, invite members, assign projects, and manage team-wide defaults.</p>
      </div>

      {error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        <TeamList
          teams={teams}
          selectedTeamId={selectedTeamId}
          onSelect={setSelectedTeamId}
          creatingTeam={creatingTeam}
          onCreateToggle={value => setCreatingTeam(value ?? !creatingTeam)}
          onCreateTeam={handleCreateTeam}
          onTeamNameChange={e => setTeamName(e.target.value)}
          teamName={teamName}
          createError={createError}
          createLoading={createLoading}
        />

        <TeamDetail
          team={selectedTeamDisplay}
          loading={loadingTeam}
          error={error}
          onRefresh={loadTeams}
          backendUrl={backendUrl}
          token={token}
        />
      </div>
    </div>
  );
}
