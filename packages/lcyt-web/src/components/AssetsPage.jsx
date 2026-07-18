/**
 * AssetsPage — `/assets`. A library view across the production assets a project
 * stores and reuses: graphics, global cues/actions, uploaded icons, caption
 * files, and broadcast history. Uses the same flat card grid layout as SetupHubPage.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { useProjectRequired } from '../hooks/useProjectRequired';
import { SetupCard, SetupItemRow } from './setup-hub/SetupCard.jsx';
import { CATEGORY_COLORS } from './setup-hub/icons.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'reusable', label: 'Reusable' },
  { id: 'produced', label: 'Produced' },
];

function styledIcon(Icon, color) {
  const cat = CATEGORY_COLORS[color] || CATEGORY_COLORS.accent;
  return function StyledIcon() {
    return (
      <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: cat.bg, color: cat.fg, flexShrink: 0 }}>
        <Icon />
      </div>
    );
  };
}

function GraphicsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3.5C2 2.67 2.67 2 3.5 2H12.5C13.33 2 14 2.67 14 3.5V12C14 12.83 13.33 13.5 12.5 13.5H3.5C2.67 13.5 2 12.83 2 12V3.5Z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4.5" cy="5.5" r="1" fill="currentColor" />
      <path d="M2 10.5L5.5 7L9.5 11L14 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CuesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L11 6H5L8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="8" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ActionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 5V8L10.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconsCardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="6" r="1.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 11.5L6 8.5L8.5 10.5L11 7.5L13.5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FilesCardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3.5C2 2.67 2.67 2 3.5 2H9L14 7V12.5C14 13.33 13.33 14 12.5 14H3.5C2.67 14 2 13.33 2 12.5V3.5Z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 8.5H12M4 10.5H12M4 12.5H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function BroadcastsCardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="9" r="1.5" fill="currentColor" />
      <path d="M5.5 7C5.5 7 4.5 7.8 4.5 9C4.5 10.2 5.5 11 5.5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10.5 7C10.5 7 11.5 7.8 11.5 9C11.5 10.2 10.5 11 10.5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="8" y1="7.5" x2="8" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function VideosIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 4.5C2 3.67 2.67 3 3.5 3H11.5C12.33 3 13 3.67 13 4.5V10C13 10.83 12.33 11.5 11.5 11.5H3.5C2.67 11.5 2 10.83 2 10V4.5Z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 6.5L10 8.5L6 10.5V6.5Z" fill="currentColor" />
      <path d="M13 6L15 4.5V12L13 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ThumbnailsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.5" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="9" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.5" y="9" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
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
  useProjectRequired();
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
  const [thumbnails, setThumbnails] = useState([]);
  const [videos, setVideos] = useState([]);
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
      setThumbnails([]);
      setVideos([]);
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

    setLoading({ graphics: true, cues: true, actions: true, icons: true, files: true, broadcasts: true, thumbnails: true, videos: true });

    try {
      const graphicsData = await fetchJson(`${backendUrl}/dsk/${encodeURIComponent(apiKey || '')}/templates`, authHeaders);
      setGraphics(Array.isArray(graphicsData?.templates) ? graphicsData.templates : []);
      setErrors(prev => ({ ...prev, graphics: false }));
    } catch {
      setGraphics([]);
      setErrors(prev => ({ ...prev, graphics: true }));
    } finally {
      setLoading(prev => ({ ...prev, graphics: false }));
    }

    try {
      const cueData = await fetchJson(`${backendUrl}/cues/rules`, authHeaders);
      setCueRules(Array.isArray(cueData?.rules) ? cueData.rules : []);
      setErrors(prev => ({ ...prev, cues: false }));
    } catch {
      setCueRules([]);
      setErrors(prev => ({ ...prev, cues: true }));
    } finally {
      setLoading(prev => ({ ...prev, cues: false }));
    }

    try {
      const actionData = await fetchJson(`${backendUrl}/actions`, authHeaders);
      setActions(Array.isArray(actionData?.actions) ? actionData.actions : []);
      setErrors(prev => ({ ...prev, actions: false }));
    } catch {
      setActions([]);
      setErrors(prev => ({ ...prev, actions: true }));
    } finally {
      setLoading(prev => ({ ...prev, actions: false }));
    }

    try {
      const iconData = await fetchJson(`${backendUrl}/icons`, authHeaders);
      setIcons(Array.isArray(iconData?.icons) ? iconData.icons : []);
      setErrors(prev => ({ ...prev, icons: false }));
    } catch {
      setIcons([]);
      setErrors(prev => ({ ...prev, icons: true }));
    } finally {
      setLoading(prev => ({ ...prev, icons: false }));
    }

    try {
      const fileData = await fetchJson(`${backendUrl}/file`, authHeaders);
      setFiles(Array.isArray(fileData?.files) ? fileData.files : []);
      setErrors(prev => ({ ...prev, files: false }));
    } catch {
      setFiles([]);
      setErrors(prev => ({ ...prev, files: true }));
    } finally {
      setLoading(prev => ({ ...prev, files: false }));
    }

    try {
      const broadcastData = await fetchJson(`${backendUrl}/broadcasts`, authHeaders);
      setBroadcasts(Array.isArray(broadcastData?.broadcasts) ? broadcastData.broadcasts : []);
      setErrors(prev => ({ ...prev, broadcasts: false }));
    } catch {
      setBroadcasts([]);
      setErrors(prev => ({ ...prev, broadcasts: true }));
    } finally {
      setLoading(prev => ({ ...prev, broadcasts: false }));
    }

    try {
      const thumbnailData = await fetchJson(`${backendUrl}/dsk/${encodeURIComponent(apiKey || '')}/thumbnails`, authHeaders);
      setThumbnails(Array.isArray(thumbnailData?.thumbnails) ? thumbnailData.thumbnails : []);
      setErrors(prev => ({ ...prev, thumbnails: false }));
    } catch {
      setThumbnails([]);
      setErrors(prev => ({ ...prev, thumbnails: true }));
    } finally {
      setLoading(prev => ({ ...prev, thumbnails: false }));
    }

    try {
      const videoData = await fetchJson(`${backendUrl}/videos`, authHeaders);
      setVideos(Array.isArray(videoData?.videos) ? videoData.videos : []);
      setErrors(prev => ({ ...prev, videos: false }));
    } catch {
      setVideos([]);
      setErrors(prev => ({ ...prev, videos: true }));
    } finally {
      setLoading(prev => ({ ...prev, videos: false }));
    }
  }, [connected, backendUrl, apiKey, token]);

  useEffect(() => { load(); }, [load]);

  const visibleCards = [
    {
      key: 'graphics',
      section: 'reusable',
      title: 'Graphics',
      description: 'Reusable DSK graphics templates.',
      icon: styledIcon(GraphicsIcon, 'purple'),
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
          href="/graphics/editor"
        />
      )),
    },
    {
      key: 'cues',
      section: 'reusable',
      title: 'Global cues',
      description: 'Reusable cue rules that trigger actions from captions.',
      icon: styledIcon(CuesIcon, 'cyan'),
      color: 'cyan',
      status: connected ? (loading.cues ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.cues ? 'Loading…' : `${cueRules.length} rule${cueRules.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/cues' },
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
          href="/cues"
        />
      )),
    },
    {
      key: 'actions',
      section: 'reusable',
      title: 'Global actions',
      description: 'Reusable named action macros for caption-driven workflows.',
      icon: styledIcon(ActionsIcon, 'accent'),
      color: 'accent',
      status: connected ? (loading.actions ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.actions ? 'Loading…' : `${actions.length} action${actions.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/actions' },
      body: !connected ? (
        <p className="setup-card__empty">Connect to a project to manage named actions.</p>
      ) : loading.actions ? (
        <p className="setup-card__empty">Loading…</p>
      ) : actions.length === 0 ? (
        <p className="setup-card__empty">No named actions yet.</p>
      ) : actions.slice(0, 4).map(action => (
        <SetupItemRow
          key={action.slug}
          name={action.name}
          meta={`@${action.slug}`}
          badge={action.definition ? 'macro' : 'empty'}
          href="/actions"
        />
      )),
    },
    {
      key: 'icons',
      section: 'reusable',
      title: 'Icons',
      description: 'Branding icons for viewer pages and overlays.',
      icon: styledIcon(IconsCardIcon, 'teal'),
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
          href="/setup/icons"
        />
      )),
    },
    {
      key: 'files',
      section: 'produced',
      title: 'Caption / rundown files',
      description: 'Passed-through caption files and rundown exports.',
      icon: styledIcon(FilesCardIcon, 'green'),
      color: 'green',
      status: connected ? (loading.files ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.files ? 'Loading…' : `${files.length} file${files.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/planner' },
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
          href="/planner"
        />
      )),
    },
    {
      key: 'broadcasts',
      section: 'produced',
      title: 'Broadcasts',
      description: 'Schedule, manage, and view broadcast history with linked YouTube casts.',
      icon: styledIcon(BroadcastsCardIcon, 'accent'),
      color: 'accent',
      status: connected ? (loading.broadcasts ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.broadcasts ? 'Loading…' : `${broadcasts.length} broadcast${broadcasts.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/broadcasts' },
      body: !connected ? (
        <p className="setup-card__empty">Connect to a project to browse broadcast history.</p>
      ) : loading.broadcasts ? (
        <p className="setup-card__empty">Loading…</p>
      ) : broadcasts.length === 0 ? (
        <p className="setup-card__empty">No broadcasts recorded yet.</p>
      ) : broadcasts.slice(0, 4).map((broadcast) => {
        const watchLinks = Array.from(new Set([...(broadcast.youtubeVideoIds || []), broadcast.youtubeBroadcastId].filter(Boolean)));
        return (
          <SetupItemRow
            key={broadcast.id}
            name={broadcast.title || `Broadcast ${broadcast.id.slice(0, 6)}`}
            meta={`Scheduled ${formatDate(broadcast.scheduledStart || broadcast.actualStart || broadcast.createdAt)}`}
            badge={(broadcast.status || 'draft').toUpperCase()}
            href="/broadcast"
            extra={watchLinks.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                {watchLinks.map((watchId) => {
                  const watchUrl = watchId.startsWith('http') ? watchId : `https://www.youtube.com/watch?v=${watchId}`;
                  return (
                    <a key={watchUrl} href={watchUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--color-accent)', textDecoration: 'none' }}>
                      Watch on YouTube ↗
                    </a>
                  );
                })}
              </div>
            ) : null}
          />
        );
      }),
    },
    {
      key: 'stored-videos',
      section: 'produced',
      title: 'Stored videos',
      description: 'Recorded broadcast playback and management.',
      icon: styledIcon(VideosIcon, 'green'),
      color: 'green',
      status: connected ? (loading.videos ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.videos ? 'Loading…' : `${videos.length} video${videos.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Open', href: '/videos' },
      body: !connected ? (
        <p className="setup-card__empty">Connect to a project to browse recorded broadcasts.</p>
      ) : loading.videos ? (
        <p className="setup-card__empty">Loading…</p>
      ) : videos.length === 0 ? (
        <p className="setup-card__empty">No recorded broadcasts yet.</p>
      ) : videos.slice(0, 4).map(video => (
        <SetupItemRow
          key={video.id}
          name={video.title || `Video ${video.id.slice(0, 6)}`}
          meta={`${video.status || 'recording'} · ${video.durationMs ? `${Math.floor(video.durationMs / 60000)}:${String(Math.floor((video.durationMs % 60000) / 1000)).padStart(2, '0')}` : '—'}`}
          badge={(video.status || 'recording').toUpperCase()}
          extra={video.sizeBytes ? <span className="setup-item-row__meta">{formatBytes(video.sizeBytes)}</span> : null}
          href="/videos"
        />
      )),
    },
    {
      key: 'thumbnails',
      section: 'reusable',
      title: 'Thumbnails',
      description: 'Still-image previews created from graphics templates.',
      icon: styledIcon(ThumbnailsIcon, 'purple'),
      color: 'purple',
      status: connected ? (loading.thumbnails ? 'partial' : 'ready') : 'partial',
      statusLabel: connected ? (loading.thumbnails ? 'Loading…' : `${thumbnails.length} thumbnail${thumbnails.length === 1 ? '' : 's'}`) : 'Connect',
      headerAction: { label: 'Create', href: '/graphics/editor' },
      body: !connected ? (
        <p className="setup-card__empty">Connect to a project to create thumbnails.</p>
      ) : loading.thumbnails ? (
        <p className="setup-card__empty">Loading…</p>
      ) : thumbnails.length === 0 ? (
        <p className="setup-card__empty">No thumbnails yet — create one from the graphics editor.</p>
      ) : thumbnails.slice(0, 4).map(thumbnail => (
        <SetupItemRow
          key={thumbnail.id}
          name={thumbnail.name || `Thumbnail ${thumbnail.id}`}
          meta={`${thumbnail.width}×${thumbnail.height}`}
          badge={thumbnail.template_id ? 'from-template' : 'orphaned'}
          extra={thumbnail.updated_at ? <span className="setup-item-row__meta">{formatDate(thumbnail.updated_at)}</span> : null}
          href="/graphics/editor"
        />
      )),
    },
  ].filter(card => filter === 'all' || card.section === filter);

  return (
    <div className="setup-hub-page">
      <div className="setup-hub-page__header">
        <h1 className="setup-hub-page__title">Assets</h1>
      </div>
      <p className="setup-hub-page__desc">
        A library view of the content this project has accumulated across reusable
        and produced assets.
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

      <div className="setup-hub-page__grid">
        {visibleCards.map(card => (
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

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 20 }}>
        Looking for device/service configuration instead? See <Link href="/setup">Setup</Link>.
      </p>
    </div>
  );
}
