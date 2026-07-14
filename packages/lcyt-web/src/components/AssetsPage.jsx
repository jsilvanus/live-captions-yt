/**
 * AssetsPage — `/assets`. A library view across the kinds of content a
 * project accumulates. Only Graphics (DSK templates) has a real counting
 * endpoint today (`GET /dsk/:key/templates`); Broadcasts uses a best-effort
 * count from `GET /stats` (past sessions, when the `stats` feature is
 * enabled). Everything else has no counting backend yet and is clearly
 * labeled "Not tracked yet" rather than showing a fabricated 0.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { SetupCard } from './setup-hub/SetupCard.jsx';
import { NamedActionsManager } from './NamedActionsManager.jsx';

const TILES = [
  { id: 'captions',      icon: '💬', title: 'Captions',     href: '/captions',    tracked: false },
  { id: 'rundowns',      icon: '📋', title: 'Rundowns',      href: '/planner',     tracked: false },
  { id: 'graphics',      icon: '🖼️', title: 'Graphics',      href: '/graphics/editor', tracked: true, key: 'graphics' },
  { id: 'translations',  icon: '🌐', title: 'Translations',  href: '/translations',tracked: false },
  { id: 'broadcasts',    icon: '📡', title: 'Broadcasts',    href: '/broadcast',   tracked: true, key: 'broadcasts' },
  { id: 'videos',        icon: '🎥', title: 'Recordings',    href: '/broadcast',   tracked: true, key: 'videos' },
  { id: 'thumbnails',    icon: '🖼️', title: 'Thumbnails',    href: '/broadcast',   tracked: false },
];

export function AssetsPage() {
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const apiKey = session?.apiKey;

  const [counts, setCounts] = useState({});
  const [errors, setErrors] = useState({});

  const load = useCallback(async () => {
    if (!connected || !backendUrl || !apiKey) return;
    const token = session?.getSessionToken?.() ?? null;

    // Graphics: GET /dsk/:apikey/templates (JWT Bearer or X-API-Key)
    try {
      const r = await fetch(`${backendUrl}/dsk/${encodeURIComponent(apiKey)}/templates`, {
        headers: token ? { Authorization: `Bearer ${token}` } : { 'X-API-Key': apiKey },
      });
      if (r.ok) {
        const data = await r.json();
        const list = Array.isArray(data) ? data : (data.templates || []);
        setCounts(c => ({ ...c, graphics: list.length }));
      } else {
        setErrors(e => ({ ...e, graphics: true }));
      }
    } catch {
      setErrors(e => ({ ...e, graphics: true }));
    }

    // Broadcasts: best-effort from GET /stats (past sessions), feature-gated
    if (token) {
      try {
        const r = await fetch(`${backendUrl}/stats`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const data = await r.json();
          setCounts(c => ({ ...c, broadcasts: (data.sessions || []).length }));
        } else {
          setErrors(e => ({ ...e, broadcasts: true }));
        }
      } catch {
        setErrors(e => ({ ...e, broadcasts: true }));
      }
    }

    if (token) {
      try {
        const r = await fetch(`${backendUrl}/videos`, { headers: { Authorization: 'Bearer ' + token } });
        if (r.ok) {
          const data = await r.json();
          setCounts(c => ({ ...c, videos: (data.videos || []).length }));
        } else {
          setErrors(e => ({ ...e, videos: true }));
        }
      } catch {
        setErrors(e => ({ ...e, videos: true }));
      }
    }
  }, [connected, backendUrl, apiKey, session]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="setup-hub-page">
      <div className="setup-hub-page__header">
        <h1 className="setup-hub-page__title">Assets</h1>
      </div>
      <p className="setup-hub-page__desc">
        A library view of the content this project has accumulated. Only a
        few categories have real counts today — the rest are shown so you
        know they exist, without inventing numbers for them.
      </p>

      <div className="setup-hub-page__grid">
        {TILES.map(tile => {
          const hasCount = tile.tracked && !errors[tile.key] && counts[tile.key] != null;
          return (
            <SetupCard
              key={tile.id}
              icon={tile.icon}
              title={tile.title}
              description={
                !connected
                  ? 'Connect to a project to see this count.'
                  : tile.tracked
                    ? (hasCount ? `${counts[tile.key]} item${counts[tile.key] === 1 ? '' : 's'}` : 'Could not load count.')
                    : 'Not tracked yet — no counting endpoint exists for this category.'
              }
              status={tile.tracked ? (hasCount ? 'ready' : 'partial') : 'soon'}
              statusLabel={tile.tracked ? (hasCount ? String(counts[tile.key]) : '—') : 'Not tracked yet'}
              action={{ label: 'Open', href: tile.href }}
            />
          );
        })}
      </div>

      <NamedActionsManager />

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 20 }}>
        Looking for device/service configuration instead? See <Link href="/setup"><a>Setup</a></Link>.
      </p>
    </div>
  );
}
