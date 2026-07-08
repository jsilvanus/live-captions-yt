import { useCallback, useEffect, useState } from 'react';
import { useUserAuth } from '../hooks/useUserAuth';
import { adminFetch } from '../lib/admin.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { AdminTabShell } from './AdminTabShell.jsx';
import { FeaturePolicyGrid } from './FeaturePolicyGrid.jsx';

/**
 * AdminSiteFeaturesPage — `/admin/site-features`. Global feature-availability
 * defaults (docs/plans/plan_site_feature_policies.md, already implemented
 * server-side: GET/PUT /admin/feature-policies) — teams can override per
 * feature in the Teams tab. Fails soft if the backend doesn't have these
 * routes wired up yet.
 */
export function AdminSiteFeaturesPage() {
  const { user, backendUrl } = useUserAuth();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminTabShell active="site-features">
        <AdminSiteFeaturesContent backendUrl={backendUrl} />
      </AdminTabShell>
    </AdminKeyGate>
  );
}

function AdminSiteFeaturesContent({ backendUrl }) {
  const [value, setValue] = useState({});
  const [binaryOnly, setBinaryOnly] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(backendUrl, '/admin/feature-policies');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const policies = data.policies || [];
      setValue(Object.fromEntries(policies.map(p => [p.code, p.mode])));
      const binaries = policies.filter(p => p.binaryOnly).map(p => p.code);
      setBinaryOnly(binaries.length > 0 ? new Set(binaries) : null);
    } catch (err) {
      setError('Site feature policies are not available on this backend yet.');
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => { load(); }, [load]);

  async function handleChange(code, mode) {
    const prev = value[code];
    setValue(v => ({ ...v, [code]: mode }));
    try {
      const res = await adminFetch(backendUrl, `/admin/feature-policies/${code}`, {
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
    <div style={{ padding: '20px 28px' }}>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 20 }}>
        Global feature defaults — teams can override per-feature access in the Teams tab.
      </p>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : (
        <FeaturePolicyGrid value={value} onChange={handleChange} binaryOnly={binaryOnly} />
      )}
    </div>
  );
}
