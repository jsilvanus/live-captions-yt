import { useCallback, useEffect, useState } from 'react';
import { useUserAuth } from '../hooks/useUserAuth';
import { adminFetch } from '../lib/admin.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { AdminTabShell } from './AdminTabShell.jsx';
import { FeaturePolicyGrid } from './FeaturePolicyGrid.jsx';

/**
 * AdminTeamsPage — `/admin/teams`. Left: search + list of every team on the
 * deployment (new GET /admin/orgs — see BACKEND_PROJECT.md item 5, today's
 * GET /orgs is scoped to the caller's own memberships only). Right: the
 * selected team's feature-access overrides (GET/PUT /admin/orgs/:id/feature-overrides,
 * already implemented per plan_site_feature_policies.md), layered on top of
 * the Site Features defaults. Fails soft if /admin/orgs isn't wired up yet.
 *
 * Deviates from the mock's literal layout (which stacks the override panel
 * underneath the list, in the same column) by putting team detail in its own
 * right-hand pane — a standard master-detail split, and a better fit for
 * scanning a long list of teams than embedding detail into the left column.
 */
export function AdminTeamsPage() {
  const { user, backendUrl } = useUserAuth();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminTabShell active="teams">
        <AdminTeamsContent backendUrl={backendUrl} />
      </AdminTabShell>
    </AdminKeyGate>
  );
}

function AdminTeamsContent({ backendUrl }) {
  const [orgs, setOrgs] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const res = await adminFetch(backendUrl, `/admin/orgs?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOrgs(data.orgs || []);
    } catch (err) {
      setError('Team administration is not available on this backend yet.');
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, search]);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const selectedOrg = orgs.find(o => o.id === selectedId) || null;

  return (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', minHeight: 0 }}>
      <div style={{ borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>Teams</p>
          <input
            className="settings-field__input"
            placeholder="Search teams…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 0' }}>
          {error && <div style={{ color: 'var(--color-error)', fontSize: 13, padding: '0 24px' }}>{error}</div>}
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '0 24px' }}>Loading…</div>
          ) : orgs.length === 0 ? (
            !error && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '0 24px' }}>No teams found.</div>
          ) : orgs.map(org => (
            <div
              key={org.id}
              onClick={() => setSelectedId(org.id)}
              role="button"
              tabIndex={0}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 24px', cursor: 'pointer',
                background: org.id === selectedId ? 'var(--color-primary-tint, rgba(46,95,163,0.08))' : 'transparent',
                borderLeft: `2.5px solid ${org.id === selectedId ? 'var(--color-primary)' : 'transparent'}`,
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 7, background: 'var(--color-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
              }}>
                {(org.name || '?').slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{org.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{org.memberCount} members</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ overflowY: 'auto', padding: '20px 24px' }}>
        {selectedOrg ? (
          <TeamOverridesPanel org={selectedOrg} backendUrl={backendUrl} />
        ) : (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            Select a team to configure its feature access overrides. These layer on top of the Site Features defaults.
          </p>
        )}
      </div>
    </div>
  );
}

function TeamOverridesPanel({ org, backendUrl }) {
  const [value, setValue] = useState({});
  const [binaryOnly, setBinaryOnly] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(backendUrl, `/admin/orgs/${org.id}/feature-overrides`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const overrides = data.overrides || [];
      setValue(Object.fromEntries(overrides.map(o => [o.code, o.mode])));
      const binaries = overrides.filter(o => o.binaryOnly).map(o => o.code);
      setBinaryOnly(binaries.length > 0 ? new Set(binaries) : null);
    } catch (err) {
      setError('Feature overrides are not available on this backend yet.');
    } finally {
      setLoading(false);
    }
  }, [backendUrl, org.id]);

  useEffect(() => { load(); }, [load]);

  async function handleChange(code, mode) {
    const prev = value[code];
    setValue(v => ({ ...v, [code]: mode }));
    try {
      const res = await adminFetch(backendUrl, `/admin/orgs/${org.id}/feature-overrides/${code}`, {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setValue(v => ({ ...v, [code]: prev }));
      setError(`Could not update '${code}'.`);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>{org.name}</p>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        Feature access overrides — pick "Default" to fall back to the site-wide policy.
      </p>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 14 }}>{error}</div>}
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : (
        <FeaturePolicyGrid value={value} onChange={handleChange} binaryOnly={binaryOnly} allowInherit />
      )}
    </div>
  );
}
