import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useUserAuth } from '../hooks/useUserAuth';
import { activateProject } from '../lib/projectSession.js';
import { FeaturePicker } from './FeaturePicker';

const FEATURE_BADGE_LABELS = {
  captions:          'Captions',
  'viewer-target':   'Viewer',
  'file-saving':     'Files',
  translations:      'Translations',
  'graphics-server': 'Graphics',
  ingest:            'RTMP',
  radio:             'Radio',
  'hls-stream':      'HLS',
  'stt-server':      'STT',
  'device-control':  'Production',
  embed:             'Embed',
};

// Placeholder thumbnail — matches the Claude Design mockup's project-row
// treatment (dark gradient tile + faint camera glyph). There's no real
// per-project preview image in the API yet, so this stays decorative/static.
export function ProjectThumbnail() {
  return (
    <div className="project-row__thumb">
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <path d="M2 5C2 4.17 2.67 3.5 3.5 3.5H9.5C10.33 3.5 11 4.17 11 5V11C11 11.83 10.33 12.5 9.5 12.5H3.5C2.67 12.5 2 11.83 2 11V5Z" stroke="white" strokeWidth="1.2" />
        <path d="M11 6.5L14 5V11L11 9.5" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function ProjectRow({ project, onUse, onManage }) {
  const badgeCodes = (project.features || []).filter(c => FEATURE_BADGE_LABELS[c]);

  return (
    <div className="project-row" onClick={() => onManage(project)} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onManage(project); }}>
      <ProjectThumbnail />

      <div className="project-row__main">
        <div className="project-row__name-line">
          <span className="project-row__name">{project.owner}</span>
          {project.myAccessLevel && (
            <span className="project-row__pill">{project.myAccessLevel}</span>
          )}
        </div>
        {badgeCodes.length > 0 && (
          <div className="project-row__badges">
            {badgeCodes.map(code => (
              <span key={code} className="project-row__badge">{FEATURE_BADGE_LABELS[code]}</span>
            ))}
          </div>
        )}
      </div>

      <div className="project-row__meta">
        {project.memberCount > 1 && <span>{project.memberCount} members</span>}
      </div>

      <div className="project-row__meta">
        <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
        {project.expires && <span className="project-row__meta-dim">Expires {new Date(project.expires).toLocaleDateString()}</span>}
      </div>

      <div className="project-row__actions" onClick={e => e.stopPropagation()}>
        <button
          className="project-row__enter"
          onClick={() => onUse(project)}
        >
          Enter
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M5 3.5L8 6.5L5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const DEFAULT_NEW_PROJECT_FEATURES = new Set(['captions', 'viewer-target', 'file-saving', 'translations', 'stats', 'mic-lock']);

function CreateProjectForm({ onCreated, onCancel, backendUrl, token }) {
  const [name, setName] = useState('');
  const [features, setFeatures] = useState(DEFAULT_NEW_PROJECT_FEATURES);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: name.trim(), features: [...features] }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onCreated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="settings-field">
        <label className="settings-field__label" htmlFor="create-project-name">Project name</label>
        <input
          id="create-project-name"
          className="settings-field__input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Sunday service"
          autoFocus
        />
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        style={{ alignSelf: 'flex-start', fontSize: 12 }}
        onClick={() => setShowAdvanced(v => !v)}
      >
        {showAdvanced ? '▾' : '▸'} Feature access
      </button>
      {showAdvanced && (
        <div style={{ background: 'var(--color-bg)', borderRadius: 6, padding: '12px', border: '1px solid var(--color-border)' }}>
          <FeaturePicker value={features} onChange={setFeatures} />
        </div>
      )}
      {error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn--ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn--primary" type="submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </form>
  );
}

export function ProjectsPage() {
  const { user, token, backendUrl, loading: authLoading, logout, requestProjectAccessToken } = useUserAuth();
  const [, navigate] = useLocation();
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      window.location.href = '/login';
    }
  }, [authLoading, user]);

  const fetchProjects = useCallback(async () => {
    if (!token || !backendUrl) return;
    setLoadingProjects(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setProjects(data.keys || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingProjects(false);
    }
  }, [token, backendUrl]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  function handleManageProject(project) {
    navigate(`/projects/${project.key}`);
  }

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

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <span style={{ color: 'var(--color-text-muted)' }}>Loading…</span>
      </div>
    );
  }

  if (!user) return null; // redirecting

  return (
    <div className="projects-page">
      <div className="projects-page__header">
        <div>
          <h1 className="projects-page__title">Projects</h1>
          <p className="projects-page__subtitle">
            {projects.length} project{projects.length === 1 ? '' : 's'}
            <span className="projects-page__dot">·</span>
            <span className="projects-page__user">{user.email}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn--ghost btn--sm" onClick={() => { logout(); window.location.href = '/login'; }}>Sign out</button>
          <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ marginRight: 6 }}>
              <path d="M5.5 1V10M1 5.5H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            New project
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {creating && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '16px 20px', background: 'var(--color-surface)', marginBottom: 16 }}>
          <CreateProjectForm
            backendUrl={backendUrl}
            token={token}
            onCreated={newKey => {
              setProjects(prev => [newKey, ...prev]);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {loadingProjects ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading projects…</div>
      ) : projects.length === 0 ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          No projects yet. Create one to get started.
        </div>
      ) : (
        <div className="projects-page__list">
          {projects.map(p => (
            <ProjectRow
              key={p.key}
              project={p}
              onUse={handleUseProject}
              onManage={handleManageProject}
            />
          ))}
        </div>
      )}

      <p style={{ marginTop: 32, fontSize: 13, color: 'var(--color-text-muted)' }}>
        <a href="/" style={{ color: 'var(--color-text-muted)' }}>← Back to app</a>
      </p>
    </div>
  );
}
