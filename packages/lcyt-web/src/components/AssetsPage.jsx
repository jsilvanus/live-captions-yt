/**
 * AssetsPage — `/assets`. A library view across the production assets a project
 * stores and reuses: graphics, global cues/actions, uploaded icons, caption
 * files, and broadcast history.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './setup-hub/SetupCard.jsx';
import { NamedActionsManager } from './NamedActionsManager.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'reusable', label: 'Reusable' },
  { id: 'produced', label: 'Produced' },
];

function emojiIcon(label) {
  return function EmojiIcon() {
    return <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>{label}</span>;
  };
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function AssetsPage() {
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const apiKey = session?.apiKey;
  const [filter, setFilter] = useState('all');

  const [graphics, setGraphics] = useState([]);
  const [cueRules, setCueRules] = useState([]);
  const [actions, setActions] = useState([]);
  const [icons, setIcons] = useState([]);
  const [files, setFiles] = useState([]);
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

  const token = session?.getSessionToken?.() ?? null;

  const load = useCallback(async () => {
    if (!connected || !backendUrl) {
      setGraphics([]);
      setCueRules([]);
      setActions([]);
      setIcons([]);
      setFiles([]);
      setBroadcasts([]);
      setLoading({});
      setErrors({});
      return;
    }

    const authHeaders = token ? { Authorization: `Bearer ${token}` } : apiKey ? { 'X-API-Key': apiKey } : {};
    const fetchJson = async (url, headers = authHeaders) => {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || response.statusText || 'Request failed');
      }
      return response.json();
    };

    setLoading({ graphics: true, cues: true, actions: true, icons: true, files: true, broadcasts: true });

    try {
      const graphicsData = await fetchJson(`${backendUrl}/dsk/${encodeURIComponent(apiKey || '')}/templates`);
      setGraphics(Array.isArray(graphicsData?.templates) ? graphicsData.templates : []);
      setErrors(prev => ({ ...prev, graphics: false }));
    } catch {
      setGraphics([]);
      setErrors(prev => ({ ...prev, graphics: true }));
    } finally {
      setLoading(prev => ({ ...prev, graphics: false }));
    }

    try {
      const cueData = await fetchJson(`${backendUrl}/cues/rules`, token ? { Authorization: `Bearer ${token}` } : authHeaders);
      setCueRules(Array.isArray(cueData?.rules) ? cueData.rules : []);
      setErrors(prev => ({ ...prev, cues: false }));
    } catch {
      setCueRules([]);
      setErrors(prev => ({ ...prev, cues: true }));
    } finally {
      setLoading(prev => ({ ...prev, cues: false }));
    }

    try {
      const actionData = await fetchJson(`${backendUrl}/actions`, token ? { Authorization: `Bearer ${token}` } : authHeaders);
      setActions(Array.isArray(actionData?.actions) ? actionData.actions : []);
      setErrors(prev => ({ ...prev, actions: false }));
    } catch {
      setActions([]);
      setErrors(prev => ({ ...prev, actions: true }));
    } finally {
      setLoading(prev => ({ ...prev, actions: false }));
    }

    try {
      const iconData = await fetchJson(`${backendUrl}/icons`, token ? { Authorization: `Bearer ${token}` } : authHeaders);
      setIcons(Array.isArray(iconData?.icons) ? iconData.icons : []);
      setErrors(prev => ({ ...prev, icons: false }));
    } catch {
      setIcons([]);
      setErrors(prev => ({ ...prev, icons: true }));
    } finally {
      setLoading(prev => ({ ...prev, icons: false }));
    }

    try {
      const fileData = await fetchJson(`${backendUrl}/file`, token ? { Authorization: `Bearer ${token}` } : authHeaders);
      setFiles(Array.isArray(fileData?.files) ? fileData.files : []);
      setErrors(prev => ({ ...prev, files: false }));
    } catch {
      setFiles([]);
      setErrors(prev => ({ ...prev, files: true }));
    } finally {
      setLoading(prev => ({ ...prev, files: false }));
    }

    try {
      const broadcastData = await fetchJson(`${backendUrl}/broadcasts`, token ? { Authorization: `Bearer ${token}` } : authHeaders);
      setBroadcasts(Array.isArray(broadcastData?.broadcasts) ? broadcastData.broadcasts : []);
      setErrors(prev => ({ ...prev, broadcasts: false }));
    } catch {
      setBroadcasts([]);
      setErrors(prev => ({ ...prev, broadcasts: true }));
    } finally {
      setLoading(prev => ({ ...prev, broadcasts: false }));
    }
  }, [connected, backendUrl, apiKey, token]);

  useEffect(() => { load(); }, [load]);

  const visibleCards = [
    {
      key: 'graphics',
      section: 'reusable',
      title: 'Graphics',
      description: 'Reusable DSK graphics templates.',
      icon: emojiIcon('🖼️'),
      color: 'purple',
      status: connected ? (loading.graphics ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.graphics ? 'Loading…' : `${graphics.length} template${graphics.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/graphics/editor' },
      body: !connected ? (
        <p className="setup-card__empty">Connect to a project to browse graphics templates.</p>
      ) : loading.graphics ? (
        <p className="setup-card__empty">Loading…</p>
      ) : graphics.length === 0 ? (
        <p className="setup-card__empty">No graphics templates yet.</p>
      ) : graphics.map(template => (
        <SetupItemRow
          key={template.id}
          name={template.name || `Template ${template.id}`}
          meta={template.updated_at ? `Updated ${formatDate(template.updated_at)}` : 'Template'}
          badge="template"
        />
      )),
    },
    {
      key: 'cues',
      section: 'reusable',
      title: 'Global cues',
      description: 'Reusable cue rules that trigger actions from captions.',
      icon: emojiIcon('🎯'),
      color: 'cyan',
      status: connected ? (loading.cues ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.cues ? 'Loading…' : `${cueRules.length} rule${cueRules.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/planner' },
      body: !connected ? (
        <p className="setup-card__empty">Connect to a project to view cue rules.</p>
      ) : loading.cues ? (
        <p className="setup-card__empty">Loading…</p>
      ) : cueRules.length === 0 ? (
        <p className="setup-card__empty">No cue rules yet.</p>
      ) : cueRules.map(rule => (
        <SetupItemRow
          key={rule.id}
          name={rule.name || 'Cue rule'}
          meta={rule.match_type || 'phrase'}
          badge={rule.enabled === false ? 'disabled' : 'active'}
        />
      )),
    },
    {
      key: 'actions',
      section: 'reusable',
      title: 'Global actions',
      description: 'Reusable named action macros for caption-driven workflows.',
      icon: emojiIcon('⚙️'),
      color: 'accent',
      status: connected ? (loading.actions ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.actions ? 'Loading…' : `${actions.length} action${actions.length === 1 ? '' : 's'}`) : 'Connect',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!connected ? (
            <p className="setup-card__empty">Connect to a project to manage named actions.</p>
          ) : loading.actions ? (
            <p className="setup-card__empty">Loading…</p>
          ) : actions.length === 0 ? (
            <p className="setup-card__empty">No named actions yet.</p>
          ) : (
            actions.slice(0, 4).map(action => (
              <SetupItemRow
                key={action.slug}
                name={action.name}
                meta={`@${action.slug}`}
                badge={action.definition ? 'macro' : 'empty'}
              />
            ))
          )}
          <div style={{ marginTop: 4 }}>
            <NamedActionsManager />
          </div>
        </div>
      ),
    },
    {
      key: 'icons',
      section: 'reusable',
      title: 'Icons',
      description: 'Branding icons for viewer pages and overlays.',
      icon: emojiIcon('🖍️'),
      color: 'teal',
      status: connected ? (loading.icons ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.icons ? 'Loading…' : `${icons.length} icon${icons.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/setup/icons' },
      body: !connected ? (
        <p className="setup-card__empty">Connect to a project to browse uploaded icons.</p>
      ) : loading.icons ? (
        <p className="setup-card__empty">Loading…</p>
      ) : icons.length === 0 ? (
        <p className="setup-card__empty">No icons uploaded yet.</p>
      ) : icons.slice(0, 4).map(icon => (
        <SetupItemRow
          key={icon.id}
          name={icon.filename}
          meta={icon.mimeType || 'image'}
          badge={formatBytes(icon.sizeBytes)}
        />
      )),
    },
    {
      key: 'files',
      section: 'produced',
      title: 'Caption / rundown files',
      description: 'Passed-through caption files and rundown exports.',
      icon: emojiIcon('🗂️'),
      color: 'green',
      status: connected ? (loading.files ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.files ? 'Loading…' : `${files.length} file${files.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/captions' },
      body: !connected ? (
        <p className="setup-card__empty">Connect to a project to browse caption files.</p>
      ) : loading.files ? (
        <p className="setup-card__empty">Loading…</p>
      ) : files.length === 0 ? (
        <p className="setup-card__empty">No caption or rundown files yet.</p>
      ) : files.slice(0, 4).map(file => (
        <SetupItemRow
          key={file.id}
          name={file.filename || file.name || 'Caption file'}
          meta={file.type || 'file'}
          badge={file.lang ? `lang: ${file.lang}` : null}
          extra={file.sizeBytes ? <span className="setup-item-row__meta">{formatBytes(file.sizeBytes)}</span> : null}
        />
      )),
    },
    {
      key: 'broadcasts',
      section: 'produced',
      title: 'Broadcasts',
      description: 'Recorded broadcast history and linked YouTube casts.',
      icon: emojiIcon('📡'),
      color: 'accent',
      status: connected ? (loading.broadcasts ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.broadcasts ? 'Loading…' : `${broadcasts.length} broadcast${broadcasts.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/broadcast' },
      body: !connected ? (
        <p className="setup-card__empty">Connect to a project to browse broadcast history.</p>
      ) : loading.broadcasts ? (
        <p className="setup-card__empty">Loading…</p>
      ) : broadcasts.length === 0 ? (
        <p className="setup-card__empty">No broadcasts recorded yet.</p>
      ) : broadcasts.slice(0, 4).map(broadcast => (
        <SetupItemRow
          key={broadcast.id}
          name={broadcast.title || `Broadcast ${broadcast.id.slice(0, 6)}`}
          meta={`Created ${formatDate(broadcast.createdAt)}`}
          badge={broadcast.status || 'draft'}
        />
      )),
    },
    {
      key: 'stored-videos',
      section: 'placeholder',
      title: 'Stored videos',
      description: 'VOD and recording storage for archived streams.',
      icon: emojiIcon('🎥'),
      color: 'muted',
      placeholder: true,
      status: 'soon',
      statusLabel: 'Planned',
    },
    {
      key: 'thumbnails',
      section: 'placeholder',
      title: 'Thumbnails',
      description: 'Auto-generated previews for graphics and broadcasts.',
      icon: emojiIcon('🖼️'),
      color: 'muted',
      placeholder: true,
      status: 'soon',
      statusLabel: 'Planned',
    },
    {
      key: 'rundowns',
      section: 'placeholder',
      title: 'Rundowns',
      description: 'Structured show rundowns linked to the planner.',
      icon: emojiIcon('📋'),
      color: 'muted',
      placeholder: true,
      status: 'soon',
      statusLabel: 'Planned',
    },
  ].filter(card => filter === 'all' || card.section === filter || (filter === 'reusable' ? card.section === 'reusable' : card.section === 'produced'));

  const sections = [
    { id: 'reusable', title: 'Reusable', cards: visibleCards.filter(card => card.section === 'reusable') },
    { id: 'produced', title: 'Produced', cards: visibleCards.filter(card => card.section === 'produced') },
    { id: 'placeholder', title: 'Not tracked yet', cards: visibleCards.filter(card => card.section === 'placeholder') },
  ].filter(section => section.cards.length > 0);

  return (
    <div className="setup-hub-page">
      <div className="setup-hub-page__header">
        <h1 className="setup-hub-page__title">Assets</h1>
      </div>
      <p className="setup-hub-page__desc">
        A library view of the content this project has accumulated, with reusable
        assets in one place and produced content in another.
      </p>

      <div className="setup-hub-page__pills">
        {FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            className={`setup-hub-page__pill${filter === f.id ? ' setup-hub-page__pill--active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {sections.map(section => (
        <section key={section.id} style={{ marginTop: 24 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>{section.title}</h2>
          <div className="setup-hub-page__grid">
            {section.cards.map(card => (
              <SetupCard
                key={card.key}
                id={card.key}
                icon={card.icon}
                color={card.color}
                title={card.title}
                description={card.description}
                status={card.status}
                statusLabel={card.statusLabel}
                placeholder={card.placeholder}
                headerAction={card.headerAction}
              >
                {card.body}
              </SetupCard>
            ))}
          </div>
        </section>
      ))}

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 20 }}>
        Looking for device/service configuration instead? See <Link href="/setup">Setup</Link>.
      </p>
    </div>
  );
}
