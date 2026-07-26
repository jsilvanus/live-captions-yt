import { KEYS } from '../lib/storageKeys.js';
import { useState, useEffect, useCallback, useContext, forwardRef, useImperativeHandle } from 'react';
import { SessionContext } from '../contexts/SessionContext';
import { useProjectRequired } from '../hooks/useProjectRequired';
import { Dialog } from './Dialog.jsx';
import { SetupItemRow } from './setup-hub/SetupCard.jsx';

function AddBridgeForm({ onCreated, onCancel, backendUrl, headers }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/production/bridge/instances`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onCreated(data); // { id, name, envContent }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
        A bridge is a small program that runs on your streaming computer and relays
        commands to AMX and Roland hardware on the local AV network.
      </p>
      <div className="settings-field">
        <label className="settings-field__label">Bridge name *</label>
        <input
          className="settings-field__input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Main church"
          autoFocus
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn--primary"
          onClick={handleCreate}
          disabled={!name.trim() || saving}
        >{saving ? 'Creating…' : 'Create'}</button>
      </div>
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>
          Download the bridge app for your platform:
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {BRIDGE_DOWNLOADS.map(({ label, platform, file }) => (
            <a key={platform} className="btn btn--ghost btn--sm" href={bridgeDownloadUrl(backendUrl, platform)} download={file}>
              ↓ {label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

const BRIDGE_DOWNLOADS = [
  { label: 'Windows (.exe)',     platform: 'win',   file: 'lcyt-bridge.exe' },
  { label: 'macOS',              platform: 'mac',   file: 'lcyt-bridge-mac' },
  { label: 'Linux (x64)',        platform: 'linux', file: 'lcyt-bridge-linux' },
  { label: 'Linux (ARM64/RPi4)', platform: 'arm',   file: 'lcyt-bridge-linux-arm64' },
];

function bridgeDownloadUrl(backendUrl, platform) {
  return `${backendUrl}/bridge-download?${platform}`;
}

/** Shown immediately after creation — displays exe + .env download buttons */
function EnvDownloadBanner({ bridge, backendUrl, onDismiss }) {
  function downloadEnv() {
    const blob = new Blob([bridge.envContent], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `lcyt-bridge-${bridge.name.replace(/\s+/g, '-')}.env`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{
      border: '1px solid var(--color-success)',
      borderRadius: 6,
      padding: 16,
      background: 'var(--color-success-bg, rgba(16,185,129,0.08))',
      marginBottom: 16,
    }}>
      <p style={{ margin: '0 0 10px', fontSize: 14 }}>
        <strong>{bridge.name}</strong> created. Download the app and its configuration file,
        place them in the same folder, then launch the app.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {BRIDGE_DOWNLOADS.map(({ label, platform, file }) => (
          <a key={platform} className="btn btn--ghost btn--sm" href={bridgeDownloadUrl(backendUrl, platform)} download={file}>
            ↓ {label}
          </a>
        ))}
        <button className="btn btn--primary btn--sm" onClick={downloadEnv}>
          ↓ Config (.env)
        </button>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 4 }}>
          Keep .env private — it contains your bridge token.
        </span>
        <button className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** Modal for sending a manual TCP or HTTP command to a bridge */
function SendCommandModal({ bridge, type, backendUrl, headers, onClose }) {
  const isTcp  = type === 'tcp';
  const title  = isTcp ? 'Send TCP command' : 'Send HTTP request';

  // TCP fields
  const [host,    setHost]    = useState('');
  const [port,    setPort]    = useState('9999');
  const [payload, setPayload] = useState('PING\r\n');

  // HTTP fields
  const [method,   setMethod]   = useState('GET');
  const [url,      setUrl]      = useState('');
  const [httpBody, setHttpBody] = useState('');

  const [sending, setSending] = useState(false);
  const [result,  setResult]  = useState(null); // { ok, error?, status?, body? }

  async function handleSend() {
    setSending(true);
    setResult(null);
    try {
      const cmd = isTcp
        ? { type: 'tcp_send', host: host.trim(), port: Number(port), payload }
        : { type: 'http_request', method, url: url.trim(), body: httpBody || undefined };

      const r = await fetch(
        `${backendUrl}/production/bridge/instances/${bridge.id}/command`,
        { method: 'POST', headers, body: JSON.stringify(cmd) },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setResult({ ok: true, ...data });
    } catch (e) {
      setResult({ ok: false, error: e.message });
    } finally {
      setSending(false);
    }
  }

  const canSend = isTcp
    ? host.trim() && port && !sending
    : url.trim() && !sending;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 8, padding: 24,
        maxWidth: 480, width: '90%',
      }}>
        <p style={{ margin: '0 0 16px', fontWeight: 600, fontSize: 15 }}>{title}</p>
        {bridge.name && (
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Bridge: <strong>{bridge.name}</strong>
          </p>
        )}

        {isTcp ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="settings-field" style={{ flex: 2 }}>
                <label className="settings-field__label">Host / IP</label>
                <input className="settings-field__input" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100" autoFocus />
              </div>
              <div className="settings-field" style={{ flex: 1 }}>
                <label className="settings-field__label">Port</label>
                <input className="settings-field__input" value={port} onChange={e => setPort(e.target.value)} placeholder="9999" type="number" min="1" max="65535" />
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-field__label">Payload</label>
              <input className="settings-field__input" value={payload} onChange={e => setPayload(e.target.value)} placeholder="PING\r\n" />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="settings-field" style={{ flex: 1 }}>
                <label className="settings-field__label">Method</label>
                <select className="settings-field__input" value={method} onChange={e => setMethod(e.target.value)}>
                  {['GET','POST','PUT','PATCH','DELETE'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="settings-field" style={{ flex: 3 }}>
                <label className="settings-field__label">URL</label>
                <input className="settings-field__input" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.1/api/action" autoFocus />
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-field__label">Body (optional, JSON or text)</label>
              <textarea
                className="settings-field__input"
                value={httpBody}
                onChange={e => setHttpBody(e.target.value)}
                rows={3}
                placeholder='{"key": "value"}'
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
          </div>
        )}

        {result && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 4, fontSize: 13,
            background: result.ok ? 'var(--color-success-bg, rgba(16,185,129,0.1))' : 'var(--color-error-bg, rgba(239,68,68,0.1))',
            color: result.ok ? 'var(--color-success)' : 'var(--color-error)',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}>
            {result.ok
              ? result.status !== undefined
                ? `✓ HTTP ${result.status} — ${JSON.stringify(result.body)}`
                : '✓ OK'
              : `✗ ${result.error}`}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
          <button className="btn btn--primary" onClick={handleSend} disabled={!canSend}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BridgeRow({ bridge, showName, onDelete, onRedownload, onSendTcp, onSendHttp, onSecurity }) {
  const lastSeen = bridge.lastSeen
    ? new Date(bridge.lastSeen + 'Z').toLocaleString()
    : 'Never';
  const connected = bridge.status === 'connected';

  return (
    <SetupItemRow
      statusDot={connected ? 'var(--color-success)' : 'var(--color-text-muted)'}
      name={showName ? bridge.name : 'Bridge'}
      meta={connected ? 'Connected' : `Last seen: ${lastSeen}`}
      extra={(
        <>
          {connected && (
            <>
              <button className="btn btn--sm btn--ghost" onClick={() => onSendTcp(bridge)} title="Send a TCP command via this bridge">TCP</button>
              <button className="btn btn--sm btn--ghost" onClick={() => onSendHttp(bridge)} title="Send an HTTP request via this bridge">HTTP</button>
            </>
          )}
          <button className="btn btn--sm btn--ghost" onClick={() => onSecurity(bridge)} title="Allowed/denied TCP commands and target IPs for this bridge">🔒 Security</button>
          <button className="btn btn--sm btn--ghost" onClick={() => onRedownload(bridge)} title="Re-download .env">↓ .env</button>
        </>
      )}
      onDelete={() => onDelete(bridge)}
    />
  );
}

/** One allow/deny rule list (either 'ip' or 'command' kind) with an inline add-row form. */
function SecurityRuleList({ title, description, kind, patternPlaceholder, rules, backendUrl, headers, bridgeId, onChanged }) {
  const [ruleType, setRuleType] = useState('deny');
  const [pattern, setPattern] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const allowCount = rules.filter(r => r.ruleType === 'allow').length;

  async function addRule() {
    setError(null);
    const trimmed = pattern.trim();
    if (!trimmed) { setError('Pattern is required'); return; }
    if (kind === 'command') {
      try { new RegExp(trimmed); } catch { setError('Not a valid regular expression'); return; }
    }
    setSaving(true);
    try {
      const r = await fetch(`${backendUrl}/production/bridge/instances/${bridgeId}/security-rules`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ruleKind: kind, ruleType, pattern: trimmed, description: desc.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setPattern('');
      setDesc('');
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(ruleId) {
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/production/bridge/instances/${bridgeId}/security-rules/${ruleId}`, {
        method: 'DELETE',
        headers,
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 13 }}>{title}</p>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--color-text-muted)' }}>{description}</p>

      {allowCount > 0 && (
        <div style={{
          fontSize: 12, padding: '6px 10px', borderRadius: 4, marginBottom: 8,
          background: 'var(--color-warning-bg, rgba(234,179,8,0.12))', color: 'var(--color-warning, #b45309)',
        }}>
          Allow-list mode: {allowCount} pattern{allowCount !== 1 ? 's' : ''} permitted — everything else will be blocked.
        </div>
      )}

      {rules.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
          No rules configured — {kind === 'ip' ? 'any target' : 'any command'} is allowed.
        </p>
      ) : (
        <div style={{ marginBottom: 8 }}>
          {rules.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
              <span style={{
                fontWeight: 600, padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase', fontSize: 10,
                color: r.ruleType === 'deny' ? 'var(--color-error)' : 'var(--color-success)',
                background: r.ruleType === 'deny' ? 'var(--color-error-bg, rgba(239,68,68,0.1))' : 'var(--color-success-bg, rgba(16,185,129,0.1))',
              }}>{r.ruleType}</span>
              <code style={{ flex: 1, wordBreak: 'break-all' }}>{r.pattern}</code>
              {r.description && <span style={{ color: 'var(--color-text-muted)' }}>{r.description}</span>}
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeRule(r.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select className="settings-field__input" style={{ width: 90 }} value={ruleType} onChange={e => setRuleType(e.target.value)}>
          <option value="deny">Deny</option>
          <option value="allow">Allow</option>
        </select>
        <input
          className="settings-field__input"
          style={{ flex: 2 }}
          placeholder={patternPlaceholder}
          value={pattern}
          onChange={e => setPattern(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addRule()}
        />
        <input
          className="settings-field__input"
          style={{ flex: 1 }}
          placeholder="Description (optional)"
          value={desc}
          onChange={e => setDesc(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addRule()}
        />
        <button type="button" className="btn btn--secondary btn--sm" onClick={addRule} disabled={saving}>+ Add</button>
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

/** Modal listing/editing a bridge's TCP command and target-IP allow/deny rules. */
function BridgeSecurityModal({ bridge, backendUrl, headers, onClose }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/production/bridge/instances/${bridge.id}/security-rules`, { headers });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setRules(data.rules ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, bridge.id]);

  useEffect(() => { load(); }, [load]);

  const ipRules = rules.filter(r => r.ruleKind === 'ip');
  const commandRules = rules.filter(r => r.ruleKind === 'command');

  return (
    <Dialog
      title={`Security — ${bridge.name}`}
      onClose={onClose}
      width={560}
      footer={<button className="btn btn--ghost" onClick={onClose}>Close</button>}
    >
      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-text-muted)' }}>
        Restrict which target IPs this bridge may connect to, and which TCP commands it may
        send. A deny rule always blocks a match, even inside an allow-list. Enforced both by the
        backend and locally by the bridge agent itself.
      </p>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : (
        <>
          {error && <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
          <SecurityRuleList
            title="Target IP / Host Rules"
            description="Exact host, *.example.com wildcard, exact IP, or CIDR — optionally with a :port suffix."
            kind="ip"
            patternPlaceholder="192.168.1.0/24 or *.internal:1319"
            rules={ipRules}
            backendUrl={backendUrl}
            headers={headers}
            bridgeId={bridge.id}
            onChanged={load}
          />
          <SecurityRuleList
            title="TCP Command Rules"
            description="Regular expression tested against the outgoing command payload."
            kind="command"
            patternPlaceholder="^PRESET-[0-9]+"
            rules={commandRules}
            backendUrl={backendUrl}
            headers={headers}
            bridgeId={bridge.id}
            onChanged={load}
          />
        </>
      )}
    </Dialog>
  );
}

function DeleteConfirmModal({ bridge, cameras, mixers, onConfirm, onCancel }) {
  const hasAssignments = cameras > 0 || mixers > 0;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 8, padding: 24,
        maxWidth: 400, width: '90%',
      }}>
        <p style={{ margin: '0 0 8px', fontWeight: 600 }}>
          Delete bridge{bridge.name ? ` "${bridge.name}"` : ''}?
        </p>
        {hasAssignments && (
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {cameras > 0 && <>{cameras} camera{cameras !== 1 ? 's' : ''}</>}
            {cameras > 0 && mixers > 0 && ' and '}
            {mixers  > 0 && <>{mixers} mixer{mixers !== 1 ? 's' : ''}</>}
            {' '}will lose their bridge assignment.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn--danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export const BridgesManager = forwardRef(function BridgesManager({ embedded = false }, ref) {
  const session    = useContext(SessionContext);
  const params     = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || session?.backendUrl || localStorage.getItem(KEYS.session.backendUrl) || '';
  const token      = params.get('token') || session?.projectAccessToken || '';

  const [bridges, setBridges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newBridge, setNewBridge] = useState(null);     // { id, name, envContent } shown after create
  const [confirmDelete, setConfirmDelete] = useState(null); // { bridge, cameras, mixers }
  const [sendCommand, setSendCommand] = useState(null);  // { bridge, type: 'tcp'|'http' }
  const [securityBridge, setSecurityBridge] = useState(null); // bridge currently showing the security modal

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  const fetchBridges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/production/bridge/instances`, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setBridges(await r.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token]);

  useEffect(() => { fetchBridges(); }, [fetchBridges]);

  useImperativeHandle(ref, () => ({ openAdd: () => setAdding(true) }));

  async function handleCreated(data) {
    setAdding(false);
    setNewBridge(data);
    fetchBridges();
  }

  async function confirmDeleteBridge(bridge) {
    // Count assigned cameras/mixers
    try {
      const r = await fetch(
        `${backendUrl}/production/bridge/instances/${bridge.id}`,
        { method: 'DELETE', headers }
      );
      if (r.status === 409) {
        const body = await r.json();
        setConfirmDelete({ bridge, cameras: body.cameras, mixers: body.mixers });
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fetchBridges();
    } catch (e) {
      setError(e.message);
    }
  }

  async function forceDelete(bridge) {
    try {
      const r = await fetch(
        `${backendUrl}/production/bridge/instances/${bridge.id}?force=1`,
        { method: 'DELETE', headers }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setConfirmDelete(null);
      fetchBridges();
    } catch (e) {
      setError(e.message);
    }
  }

  // GET .../env now requires the same project auth as every other route
  // here (closed alongside the security-rules feature) — window.open() has
  // no way to attach an Authorization header, so this fetches with headers
  // and downloads the response as a blob, same as EnvDownloadBanner's
  // downloadEnv() already does for the just-created bridge's envContent.
  async function handleRedownload(bridge) {
    try {
      const r = await fetch(`${backendUrl}/production/bridge/instances/${bridge.id}/env`, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const content = await r.text();
      const blob = new Blob([content], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `lcyt-bridge-${bridge.name.replace(/\s+/g, '-')}.env`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }

  const showNames = bridges.length >= 2;

  return (
    <div style={embedded ? undefined : { padding: 20, maxWidth: 700, margin: '0 auto' }}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Bridges</h2>
          {!adding && (
            <button className="btn btn--primary btn--sm" onClick={() => setAdding(true)}>
              + Add bridge
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--color-error)', margin: embedded ? '0 18px 12px' : '0 0 12px', fontSize: 13 }}>{error}</div>
      )}

      {newBridge && (
        <div style={embedded ? { margin: '0 18px 12px' } : undefined}>
          <EnvDownloadBanner bridge={newBridge} backendUrl={backendUrl} onDismiss={() => setNewBridge(null)} />
        </div>
      )}

      {adding && (
        <Dialog title="Add bridge" onClose={() => setAdding(false)}>
          <AddBridgeForm
            onCreated={handleCreated}
            onCancel={() => setAdding(false)}
            backendUrl={backendUrl}
            headers={headers}
          />
        </Dialog>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', padding: embedded ? '0 18px 14px' : 0 }}>Loading…</p>
      ) : bridges.length === 0 ? (
        <p className={embedded ? 'setup-card__empty' : undefined} style={embedded ? undefined : { color: 'var(--color-text-muted)' }}>No bridges configured.</p>
      ) : (
        <div className={embedded ? undefined : 'setup-card'}>
          {bridges.map(b => (
            <BridgeRow
              key={b.id}
              bridge={b}
              showName={showNames}
              onDelete={confirmDeleteBridge}
              onRedownload={handleRedownload}
              onSendTcp={bridge => setSendCommand({ bridge, type: 'tcp' })}
              onSendHttp={bridge => setSendCommand({ bridge, type: 'http' })}
              onSecurity={bridge => setSecurityBridge(bridge)}
            />
          ))}
        </div>
      )}

      {securityBridge && (
        <BridgeSecurityModal
          bridge={securityBridge}
          backendUrl={backendUrl}
          headers={headers}
          onClose={() => setSecurityBridge(null)}
        />
      )}

      {confirmDelete && (
        <DeleteConfirmModal
          bridge={confirmDelete.bridge}
          cameras={confirmDelete.cameras}
          mixers={confirmDelete.mixers}
          onConfirm={() => forceDelete(confirmDelete.bridge)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {sendCommand && (
        <SendCommandModal
          bridge={sendCommand.bridge}
          type={sendCommand.type}
          backendUrl={backendUrl}
          headers={headers}
          onClose={() => setSendCommand(null)}
        />
      )}
    </div>
  );
});

/** ProductionBridgesPage — standalone route wrapper around BridgesManager. */
export function ProductionBridgesPage() {
  useProjectRequired();
  return <BridgesManager />;
}
