import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useUserAuth } from '../hooks/useUserAuth';
import { adminFetch } from '../lib/admin.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { AdminTabShell } from './AdminTabShell.jsx';
import { Sparkline } from './charts/Sparkline.jsx';
import { BarChart } from './charts/BarChart.jsx';

// ── Admin Metrics Page (plan_metering_audit §6.2) ──────────────────────────
// Live panel (5 s poll of /admin/metrics/live) + time-range rollup sparklines
// + top-N projects for a selected metric.

export function AdminMetricsPage() {
  const session = useSessionContext();
  const { user, backendUrl: authBackendUrl } = useUserAuth();
  const backendUrl = authBackendUrl || session.backendUrl;

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminTabShell active="metrics">
        <AdminMetricsContent backendUrl={backendUrl} />
      </AdminTabShell>
    </AdminKeyGate>
  );
}

const RANGES = [
  { id: '24h', label: '24 h', days: 1, grain: 'hour' },
  { id: '7d',  label: '7 d',  days: 7, grain: 'hour' },
  { id: '30d', label: '30 d', days: 30, grain: 'day' },
  { id: '90d', label: '90 d', days: 90, grain: 'day' },
];

export function formatMetricValue(metric, value) {
  if (metric.includes('bytes')) {
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)} kB`;
    return `${Math.round(value)} B`;
  }
  if (metric.includes('seconds')) {
    if (value >= 3600) return `${(value / 3600).toFixed(1)} h`;
    if (value >= 60) return `${(value / 60).toFixed(1)} min`;
    return `${Math.round(value)} s`;
  }
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(Math.round(value * 100) / 100);
}

function rangeFrom(range) {
  const from = new Date(Date.now() - range.days * 86_400_000);
  return range.grain === 'day' ? from.toISOString().slice(0, 10) : `${from.toISOString().slice(0, 13)}:00:00Z`;
}

function StatTile({ label, value, hint }) {
  return (
    <div style={{ padding: '12px 16px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, minWidth: 130 }}>
      <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</div>
      {hint ? <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

function AdminMetricsContent({ backendUrl }) {
  const [live, setLive] = useState(null);
  const [rangeId, setRangeId] = useState('7d');
  const [series, setSeries] = useState([]);
  const [topMetric, setTopMetric] = useState('captions.sent');
  const [topProjects, setTopProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const range = RANGES.find(r => r.id === rangeId) || RANGES[1];

  // Live panel — 5 s poll
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const res = await adminFetch(backendUrl, '/admin/metrics/live');
        if (res.ok && !stopped) setLive(await res.json());
      } catch { /* backend unreachable — keep last value */ }
    }
    poll();
    const timer = setInterval(poll, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [backendUrl]);

  // Rollup series for the selected range
  const loadSeries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ grain: range.grain, from: rangeFrom(range), groupBy: 'metric' });
      const res = await adminFetch(backendUrl, `/admin/metrics/rollups?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSeries(data.series || []);
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl, rangeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSeries(); }, [loadSeries]);

  // Top projects for the selected metric
  useEffect(() => {
    let stopped = false;
    (async () => {
      const params = new URLSearchParams({ grain: range.grain, from: rangeFrom(range), groupBy: 'project', metrics: topMetric });
      const res = await adminFetch(backendUrl, `/admin/metrics/rollups?${params}`);
      if (res.ok && !stopped) {
        const data = await res.json();
        const totals = (data.series || []).map(s => ({
          label: s.key || '(system)',
          value: s.points.reduce((sum, [, v]) => sum + v, 0),
        }));
        setTopProjects(totals);
      }
    })();
    return () => { stopped = true; };
  }, [backendUrl, rangeId, topMetric]); // eslint-disable-line react-hooks/exhaustive-deps

  const sseTotal = live ? Object.values(live.sse || {}).reduce((a, b) => a + b, 0) : 0;
  const ffmpegTotal = live ? Object.values(live.ffmpeg || {}).reduce((a, b) => a + b, 0) : 0;
  const ffmpegHint = live && Object.keys(live.ffmpeg || {}).length > 0
    ? Object.entries(live.ffmpeg).map(([purpose, n]) => `${purpose}: ${n}`).join(', ')
    : null;
  const burstActive = live?.burst?.active?.length ?? 0;
  const metricNames = [...new Set(series.map(s => s.metric))].sort();

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h2 style={{ marginBottom: 16 }}>📈 Metrics</h2>

      {/* Live panel */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Active sessions" value={live ? live.activeSessions : '—'} />
        <StatTile label="SSE connections" value={live ? sseTotal : '—'} />
        <StatTile label="ffmpeg processes" value={live ? ffmpegTotal : '—'} hint={ffmpegHint} />
        <StatTile label="Burst VMs" value={live?.burst ? burstActive : '—'} hint={live?.burst ? `${Math.round((live.burst.totals?.vmSecondsTotal || 0) / 3600)} h total` : 'orchestrator not configured'} />
      </div>

      {/* Range selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Range:</span>
        {RANGES.map(r => (
          <button key={r.id}
            className={`btn btn--sm ${rangeId === r.id ? '' : 'btn--ghost'}`}
            onClick={() => setRangeId(r.id)}>
            {r.label}
          </button>
        ))}
        {loading && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>⏳</span>}
      </div>

      {/* Rollup sparklines */}
      {series.length === 0 && !loading ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          No usage recorded in this range yet — rollups appear after the first flushed activity.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12, marginBottom: 28 }}>
          {series.map(s => {
            const total = s.points.reduce((sum, [, v]) => sum + v, 0);
            return (
              <div key={s.metric} style={{ padding: '10px 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{s.metric}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Σ {formatMetricValue(s.metric, total)}</span>
                </div>
                <Sparkline points={s.points} formatValue={(v) => formatMetricValue(s.metric, v)} />
              </div>
            );
          })}
        </div>
      )}

      {/* Top projects */}
      <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Top projects</h3>
        <select value={topMetric} onChange={e => setTopMetric(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }}>
          {(metricNames.length > 0 ? metricNames : [topMetric]).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div style={{ padding: '12px 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, maxWidth: 640 }}>
        <BarChart items={topProjects} formatValue={(v) => formatMetricValue(topMetric, v)} />
      </div>
    </div>
  );
}
