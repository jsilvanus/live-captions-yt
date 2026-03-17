import { useState, useEffect, useCallback } from 'react';
import { useUserAuth } from '../hooks/useUserAuth';
import { KEYS } from '../lib/storageKeys.js';

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function maskKey(key) {
  if (!key || key.length < 8) return key;
  return key.slice(0, 8) + '••••••••••••••••••••••••••••';
}

function ProjectCard({ project, onUse, onRename, onDelete }) {
  const [showKey, setShowKey] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(project.owner);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleRename(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onRename(project.key, newName.trim());
      setRenaming(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '16px 20px',
      background: 'var(--color-surface)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {renaming ? (
        <form onSubmit={handleRename} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="settings-field__input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
            style={{ flex: 1 }}
          />
          <button className="btn btn--primary btn--sm" type="submit" disabled={saving}>
            {saving ? '…' : 'Save'}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setRenaming(false); setNewName(project.owner); }}>
            Cancel
          </button>
        </form>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 15, flex: 1, color: 'var(--color-text)' }}>
            {project.owner}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={() => setRenaming(true)} title="Rename">
            Rename
          </button>
        </div>
      )}
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{
          fontSize: 12,
          fontFamily: 'monospace',
          color: 'var(--color-text-muted)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {showKey ? project.key : maskKey(project.key)}
        </code>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => setShowKey(v => !v)}
          title={showKey ? 'Hide key' : 'Show key'}
        >
          {showKey ? 'Hide' : 'Show'}
        </button>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => copyToClipboard(project.key)}
          title="Copy API key"
        >
          Copy
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        Created {new Date(project.createdAt).toLocaleDateString()}
        {project.expires && ` · Expires ${new Date(project.expires).toLocaleDateString()}`}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          className="btn btn--primary btn--sm"
          onClick={() => onUse(project)}
          style={{ flex: 1 }}
        >
          Use this project
        </button>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => onDelete(project.key)}
          style={{ color: 'var(--color-error)' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function CreateProjectForm({ onCreated, onCancel, backendUrl, token }) {
  const [name, setName] = useState('');
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
        body: JSON.stringify({ name: name.trim() }),
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
  const { user, token, backendUrl, loading: authLoading, logout } = useUserAuth();
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

  function handleUseProject(project) {
    try {
      const existing = JSON.parse(localStorage.getItem(KEYS.session.config) || '{}');
      localStorage.setItem(KEYS.session.config, JSON.stringify({
        ...existing,
        backendUrl,
        apiKey: project.key,
      }));
    } catch {
      localStorage.setItem(KEYS.session.config, JSON.stringify({ backendUrl, apiKey: project.key }));
    }
    window.location.href = '/';
  }

  async function handleRename(key, newName) {
    const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: newName }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    setProjects(prev => prev.map(p => p.key === key ? { ...p, owner: data.owner } : p));
  }

  async function handleDelete(key) {
    if (!confirm('Delete this project? The API key will be revoked.')) return;
    const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      alert(data.error || `HTTP ${r.status}`);
      return;
    }
    setProjects(prev => prev.filter(p => p.key !== key));
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
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      padding: '32px 24px',
      maxWidth: 600,
      margin: '0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text)' }}>Projects</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{user.email}</span>
          <button className="btn btn--ghost btn--sm" onClick={logout}>Sign out</button>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        Each project has its own API key. Select a project to use it in the app.
      </p>

      {error && (
        <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {creating ? (
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
      ) : (
        <button
          className="btn btn--primary"
          onClick={() => setCreating(true)}
          style={{ marginBottom: 16 }}
        >
          + New project
        </button>
      )}

      {loadingProjects ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading projects…</div>
      ) : projects.length === 0 ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          No projects yet. Create one to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {projects.map(p => (
            <ProjectCard
              key={p.key}
              project={p}
              onUse={handleUseProject}
              onRename={handleRename}
              onDelete={handleDelete}
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
