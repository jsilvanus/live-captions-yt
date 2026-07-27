/**
 * Setup Hub — "Broadcast platforms" card.
 *
 * Connect one or more YouTube channels to this project. Multi-channel is the
 * normal case (resolved decision #1), so the card lists every connected
 * account with its own disconnect action and keeps "Connect a channel"
 * available even when one is already connected.
 *
 * Replaces the connect/token half of the retired `broadcast/YouTubeTab.jsx`,
 * whose Google Identity Services implicit token lived only in the open tab.
 */
import { useEffect, useState } from 'react';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { BroadcastPlatformsIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';
import { usePlatformCredentials, describePlatformError } from '../../hooks/usePlatforms.js';

const PLATFORMS = [
  { id: 'youtube', label: 'YouTube' },
];

/** Read the flags the OAuth callback redirect leaves on the URL, then clear them. */
function useConnectResult(onConnected) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('connected')) return;
    const ok = params.get('connected') === '1';
    setResult({
      ok,
      platform: params.get('platform') || '',
      account: params.get('account') || '',
      reason: params.get('reason') || '',
    });
    // Strip the flags so a refresh doesn't re-announce a stale outcome.
    params.delete('connected'); params.delete('platform');
    params.delete('account'); params.delete('reason');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    if (ok) onConnected?.();
  }, [onConnected]);

  return [result, setResult];
}

const REASON_TEXT = {
  denied: 'You cancelled the consent screen.',
  bad_state: 'The authorization link expired or was tampered with. Try connecting again.',
  missing_code: 'The provider did not return an authorization code.',
  exchange_failed: 'The authorization code could not be exchanged. Check the server’s client ID and secret.',
};

export function PlatformsSection() {
  const { credentials, storageAvailable, loading, error, reload, api } = usePlatformCredentials();
  const [connectResult, setConnectResult] = useConnectResult(reload);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(null);
  const [warning, setWarning] = useState('');

  async function connect(platform) {
    setActionError('');
    setBusy(platform);
    try {
      const { url } = await api.startConnect(platform);
      // A top-level navigation, not a fetch: the consent screen is
      // cross-origin and cannot be followed by XHR.
      window.location.assign(url);
    } catch (err) {
      setActionError(describePlatformError(err));
      setBusy('');
    }
  }

  async function disconnect(credential) {
    setActionError('');
    setWarning('');
    setBusy(credential.credentialId);
    try {
      const result = await api.disconnect(credential.platform, credential.credentialId);
      // The provider may refuse revocation even though we disconnected
      // locally — say so rather than implying a clean break.
      if (result?.warning) setWarning(result.warning);
      await reload();
    } catch (err) {
      setActionError(describePlatformError(err));
    } finally {
      setBusy('');
      setConfirmDisconnect(null);
    }
  }

  const connected = credentials.filter(c => !c.revokedAt);
  const status = !storageAvailable ? 'partial' : (connected.length ? 'ready' : undefined);
  const statusLabel = !storageAvailable ? 'Not available' : undefined;

  // SetupCard renders `children || emptyText`. A JSX child list is always a
  // truthy array, so handing it both would mean emptyText never appeared —
  // only pass children when there is genuinely something to show.
  const hasBody = !storageAvailable || !!connectResult || !!error || !!actionError
    || !!warning || connected.length > 0;

  return (
    <>
      <SetupCard
        id="broadcast-platforms"
        icon={BroadcastPlatformsIcon}
        color="accent"
        title="Broadcast platforms"
        description="Connect YouTube channels so broadcasts can be scheduled, given a thumbnail, taken live, and measured from inside LCYT."
        status={status}
        statusLabel={statusLabel}
        emptyText={loading ? 'Loading…' : 'No channels connected yet.'}
        headerAction={storageAvailable ? {
          label: connected.length ? 'Connect another' : 'Connect a channel',
          onClick: () => connect('youtube'),
        } : undefined}
        footerLink={{ href: '/broadcasts', label: 'Manage broadcasts' }}
      >
        {hasBody ? <>
        {!storageAvailable && (
          <p className="setup-card__empty">
            This server has no <code>PLATFORM_CREDENTIAL_KEY</code> configured, so platform
            credentials cannot be stored securely. Ask an administrator to set one.
          </p>
        )}

        {connectResult && (
          <p className="setup-card__empty" role="status" style={connectResult.ok ? undefined : errorStyle}>
            {connectResult.ok
              ? `Connected ${connectResult.account || connectResult.platform}.`
              : `Could not connect: ${REASON_TEXT[connectResult.reason] || connectResult.reason || 'unknown error'}`}
            {' '}
            <button type="button" style={linkButtonStyle} onClick={() => setConnectResult(null)}>Dismiss</button>
          </p>
        )}

        {(error || actionError) && (
          <p className="setup-card__empty" role="alert" style={errorStyle}>{error || actionError}</p>
        )}
        {warning && <p className="setup-card__empty" role="status">{warning}</p>}

        {connected.map(cred => (
          <SetupItemRow
            key={cred.credentialId}
            name={cred.accountLabel || cred.externalAccountId}
            meta={`${PLATFORMS.find(p => p.id === cred.platform)?.label || cred.platform} · connected ${formatDate(cred.connectedAt)}`}
            badge={busy === cred.credentialId ? 'Disconnecting…' : undefined}
            onDelete={() => setConfirmDisconnect(cred)}
          />
        ))}
        </> : undefined}
      </SetupCard>

      {confirmDisconnect && (
        <Dialog
          onClose={() => setConfirmDisconnect(null)}
          title="Disconnect this channel?"
          footer={(
            <>
              <button type="button" onClick={() => setConfirmDisconnect(null)}>Cancel</button>
              <button
                type="button"
                className="danger"
                disabled={busy === confirmDisconnect.credentialId}
                onClick={() => disconnect(confirmDisconnect)}
              >
                Disconnect
              </button>
            </>
          )}
        >
          <p>
            LCYT will stop being able to schedule, go live, or read viewer stats for{' '}
            <strong>{confirmDisconnect.accountLabel || confirmDisconnect.externalAccountId}</strong>.
            Broadcasts already scheduled on the platform are not affected.
          </p>
          <p style={{ opacity: 0.8, fontSize: '0.9em' }}>
            We will also ask the provider to revoke the grant, so LCYT disappears from your
            account’s third-party access list.
          </p>
        </Dialog>
      )}
    </>
  );
}

const errorStyle = { color: 'var(--danger, #c0392b)' };
const linkButtonStyle = {
  background: 'none', border: 'none', padding: 0,
  color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit',
};

function formatDate(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}
