import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { FeedsIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';
import { useSetupT } from '../../lib/useSetupT.js';
import { FEEDS_CHANGED_EVENT, notifyFeedsChanged, deviceNameKey } from '../../lib/deviceFeeds.js';
import { useDeviceNames } from './useDeviceFeeds.js';

const LIVE_DOT    = 'var(--color-success)';
const OFFLINE_DOT = 'var(--color-text-muted)';
const UNKNOWN_DOT = 'var(--color-border)';

const HINT_STYLE = { fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0' };

function statusDotFor(live) {
  if (live === true) return LIVE_DOT;
  if (live === false) return OFFLINE_DOT;
  return UNKNOWN_DOT; // null/undefined: unknown (e.g. the DSK slot has no publish tracking)
}

const shortId = id => String(id || '').slice(0, 8);

const EMPTY_FORM = { name: '', feedKey: '', transport: 'rtmp', kind: 'generic', label: '' };

function formFrom(feed) {
  return { name: feed.name, feedKey: feed.feedKey || '', transport: feed.transport, kind: feed.kind, label: feed.label || '' };
}

/**
 * Request body for POST/PATCH /feeds. An empty key is left out (the server generates one on create and keeps
 * the current one on edit). A label only means something for generic feeds, so other kinds send null.
 */
export function feedBody(form) {
  const body = {
    name: form.name.trim(),
    transport: form.transport,
    kind: form.kind,
    label: form.kind === 'generic' ? (form.label.trim() || null) : null,
  };
  if (form.feedKey.trim()) body.feedKey = form.feedKey.trim();
  return body;
}

/**
 * FeedsSection: the Setup Hub "Feeds" card (`/setup/feeds`, replaces Ingestion; plan_feeds_devices.md PR 3).
 *
 * Rows come from `GET /feeds`: the two managed feeds first (the project's Video slot and DSK path, shown with
 * their enable switch and rotate from `GET /ingestion/config`), then the named feeds, which can be added,
 * edited and deleted here. Each named row shows its kind, label, transport, ingest URL, live dot and linked
 * device. "Monitor" marks a feed no egress relay uses (computed from `GET /stream`, not stored).
 */
export function FeedsSection() {
  const session = useSessionContext();
  const t = useSetupT();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const getSessionToken = session?.getSessionToken;

  const [feeds, setFeeds] = useState(null);           // null until GET /feeds has answered
  const [config, setConfig] = useState(null);         // GET /ingestion/config: the Video and DSK switches
  const [relays, setRelays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');             // last failed action, shown above the rows
  const [slotDialog, setSlotDialog] = useState(null); // 'video' | 'dsk' | null
  const [feedDialog, setFeedDialog] = useState(null); // { mode: 'add' } | { mode: 'edit', feed } | null
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const authedFetch = useCallback((path, opts = {}) => {
    const token = getSessionToken?.();
    return fetch(`${backendUrl}/api/v1${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [backendUrl, getSessionToken]);

  // Device names for the linked-device chip (fetched once; a device added later shows its id until reload).
  const deviceNames = useDeviceNames({ connected, backendUrl, getSessionToken });

  const loadFeeds = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const r = await authedFetch('/feeds');
      setFeeds(r.ok ? ((await r.json())?.feeds || []) : null);
    } catch { setFeeds(null); }
    finally { setLoading(false); }
  }, [connected, authedFetch]);

  // Reloads when a feed changes anywhere on the page (the Devices card links feeds too).
  useEffect(() => {
    window.addEventListener(FEEDS_CHANGED_EVENT, loadFeeds);
    return () => window.removeEventListener(FEEDS_CHANGED_EVENT, loadFeeds);
  }, [loadFeeds]);

  const loadConfig = useCallback(async () => {
    if (!connected) return;
    try {
      const r = await authedFetch('/ingestion/config');
      if (r.ok) setConfig((await r.json()) || null);
    } catch { /* leave config as it is */ }
  }, [connected, authedFetch]);

  const loadRelays = useCallback(async () => {
    if (!connected) return;
    try {
      const r = await authedFetch('/stream');
      if (!r.ok) return;
      setRelays((await r.json())?.relays || []);
    } catch { /* RTMP relay not active on this backend: no relays */ }
  }, [connected, authedFetch]);

  useEffect(() => {
    loadFeeds();
    loadConfig();
    loadRelays();
  }, [loadFeeds, loadConfig, loadRelays]);

  const managed = (feeds || []).filter(f => f.managed);
  const named = (feeds || []).filter(f => !f.managed);

  // A named feed is in use when an egress relay sources from it, or from the camera it is linked to.
  function isInUse(feed) {
    return relays.some(r => (r.sourceFeedId && r.sourceFeedId === feed.id)
      || (feed.deviceType === 'camera' && r.sourceCameraId && r.sourceCameraId === feed.deviceId));
  }

  async function toggleSlot(slot, enabled) {
    setError('');
    setConfig(c => (c ? { ...c, [slot]: { ...c[slot], enabled } } : c));
    try {
      const r = await authedFetch('/ingestion/config', { method: 'PATCH', body: JSON.stringify({ [slot]: { enabled } }) });
      if (!r.ok) setError(t('feeds.err.toggle'));
    } catch { setError(t('feeds.err.toggle')); }
    loadConfig(); // reconcile the optimistic switch with the server either way
  }

  async function rotateVideoKey() {
    if (!window.confirm(t('feeds.rotateConfirm'))) return;
    setError('');
    try {
      const r = await authedFetch('/ingestion/config/rotate', { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      loadFeeds();
      loadConfig();
    } catch { setError(t('feeds.err.rotate')); }
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setFormError('');
    setFeedDialog({ mode: 'add' });
  }

  function openEdit(feed) {
    setForm(formFrom(feed));
    setFormError('');
    setFeedDialog({ mode: 'edit', feed });
  }

  function setField(name, value) {
    setForm(f => ({ ...f, [name]: value }));
  }

  async function saveFeed() {
    if (!form.name.trim()) { setFormError(t('feeds.err.name')); return; }
    const editing = feedDialog.mode === 'edit';
    setSaving(true);
    setFormError('');
    try {
      const r = await authedFetch(editing ? `/feeds/${encodeURIComponent(feedDialog.feed.id)}` : '/feeds', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(feedBody(form)),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        // 409 = the key is taken; 400 carries the server's reason (its wording is not translated).
        setFormError(r.status === 409 ? t('feeds.err.keyTaken') : (data.error || t('feeds.err.save')));
        return;
      }
      setFeedDialog(null);
      notifyFeedsChanged();
    } catch {
      setFormError(t('feeds.err.save'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteFeed(feed) {
    if (!window.confirm(t('feeds.confirmDelete', { name: feed.name }))) return;
    setError('');
    try {
      const r = await authedFetch(`/feeds/${encodeURIComponent(feed.id)}`, { method: 'DELETE' });
      if (!r.ok) { setError(t('feeds.err.delete')); return; }
      notifyFeedsChanged();
    } catch { setError(t('feeds.err.delete')); }
  }

  function managedRow(feed) {
    const slot = feed.id === 'managed:dsk' ? 'dsk' : 'video';
    const sw = config?.[slot];
    return (
      <SetupItemRow
        key={feed.id}
        name={t(`feeds.managed.${slot}`)}
        meta={sw?.enabled === false ? t('feeds.disabled') : feed.ingestUrl}
        badge={t(`feeds.kind.${feed.kind}`)}
        statusDot={statusDotFor(feed.live)}
        toggleOn={!!sw?.enabled}
        onToggle={sw ? () => toggleSlot(slot, !sw.enabled) : undefined}
        onSettings={() => setSlotDialog(slot)}
      />
    );
  }

  function feedRow(feed) {
    const monitor = !isInUse(feed);
    const url = feed.transport === 'whip' ? feed.whipUrl : feed.ingestUrl;
    const meta = [t(`feeds.transport.${feed.transport}`), url].filter(Boolean).join(' · ');
    return (
      <SetupItemRow
        key={feed.id}
        name={feed.name}
        meta={meta}
        badge={monitor ? t('feeds.monitor') : t(`feeds.kind.${feed.kind}`)}
        faded={monitor}
        statusDot={statusDotFor(feed.live)}
        extra={(feed.label || feed.deviceType) ? (
          <>
            {feed.label && <span className="setup-item-row__badge">{feed.label}</span>}
            {feed.deviceType && (
              <span className="setup-item-row__badge">
                {deviceNames.has(deviceNameKey(feed.deviceType, feed.deviceId))
                  ? t('feeds.linkedName', { name: deviceNames.get(deviceNameKey(feed.deviceType, feed.deviceId)) })
                  : t('feeds.linked', { type: t(`feeds.deviceType.${feed.deviceType}`), id: shortId(feed.deviceId) })}
              </span>
            )}
          </>
        ) : null}
        onSettings={() => openEdit(feed)}
        onDelete={() => deleteFeed(feed)}
      />
    );
  }

  const slotRow = slotDialog ? managed.find(f => f.id === `managed:${slotDialog}`) : null;

  return (
    <SetupCard
      id="feeds"
      icon={FeedsIcon}
      color="cyan"
      title={t('hub.card.feeds')}
      description={t('feeds.desc')}
      status="ready"
      headerAction={connected ? { label: t('feeds.add'), onClick: openAdd } : undefined}
    >
      {!connected ? (
        <p className="setup-card__empty">{t('feeds.connect')}</p>
      ) : (
        <>
          {error && <p role="alert" className="setup-card__empty" style={{ color: 'var(--color-error)' }}>{error}</p>}
          {feeds === null ? (
            <p className="setup-card__empty">{loading ? t('feeds.loading') : t('feeds.unavailable')}</p>
          ) : (
            <>
              {managed.map(managedRow)}
              {named.map(feedRow)}
              {named.length === 0 && <p className="setup-card__empty">{t('feeds.empty')}</p>}
            </>
          )}
        </>
      )}

      {slotDialog && (
        <Dialog title={t('feeds.slotTitle', { name: t(`feeds.managed.${slotDialog}`) })} onClose={() => setSlotDialog(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="settings-field">
              <label className="settings-field__label">{t('feeds.ingestUrl')}</label>
              <input className="settings-field__input" readOnly
                value={slotRow?.ingestUrl || ''}
                onClick={e => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            {slotDialog === 'video' && config?.video?.rotatable && (
              <div>
                <button type="button" className="btn btn--secondary btn--sm" onClick={rotateVideoKey}>{t('feeds.rotate')}</button>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {feedDialog && (
        <Dialog
          title={feedDialog.mode === 'edit' ? t('feeds.editTitle') : t('feeds.addTitle')}
          onClose={() => setFeedDialog(null)}
          footer={(
            <>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setFeedDialog(null)}>{t('feeds.cancel')}</button>
              <button type="button" className="btn btn--primary btn--sm" onClick={saveFeed} disabled={saving}>{t('feeds.save')}</button>
            </>
          )}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="feeds-name">{t('feeds.field.name')}</label>
              <input id="feeds-name" className="settings-field__input" value={form.name}
                onChange={e => setField('name', e.target.value)} />
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="feeds-key">{t('feeds.field.key')}</label>
              <input id="feeds-key" className="settings-field__input" value={form.feedKey}
                onChange={e => setField('feedKey', e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} />
              <p style={HINT_STYLE}>{t('feeds.field.keyHint')}</p>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="feeds-transport">{t('feeds.field.transport')}</label>
              <select id="feeds-transport" className="settings-field__input" value={form.transport}
                onChange={e => setField('transport', e.target.value)}>
                <option value="rtmp">{t('feeds.transport.rtmp')}</option>
                <option value="whip">{t('feeds.transport.whip')}</option>
              </select>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="feeds-kind">{t('feeds.field.kind')}</label>
              <select id="feeds-kind" className="settings-field__input" value={form.kind}
                onChange={e => setField('kind', e.target.value)}>
                <option value="generic">{t('feeds.kind.generic')}</option>
                <option value="camera">{t('feeds.kind.camera')}</option>
                <option value="dsk">{t('feeds.kind.dsk')}</option>
              </select>
            </div>
            {form.kind === 'generic' && (
              <div className="settings-field">
                <label className="settings-field__label" htmlFor="feeds-label">{t('feeds.field.label')}</label>
                <input id="feeds-label" className="settings-field__input" value={form.label}
                  onChange={e => setField('label', e.target.value)} />
                <p style={HINT_STYLE}>{t('feeds.field.labelHint')}</p>
              </div>
            )}
            {formError && <p role="alert" style={{ color: 'var(--color-error)', fontSize: 12, margin: 0 }}>{formError}</p>}
          </div>
        </Dialog>
      )}
    </SetupCard>
  );
}
