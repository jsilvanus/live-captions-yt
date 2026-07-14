import { useState, useEffect } from 'react';
import { useConnectionContext } from '../contexts/ConnectionContext';
import { Dialog } from './Dialog';

/**
 * Monitors backend connection health and shows an error dialog when the backend is unreachable.
 * Automatically retries connection checks periodically.
 */
export function ConnectionStatusMonitor() {
  const { healthStatus, connected, backendUrl, checkHealth, reconnectNow } = useConnectionContext();
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);

  // Show error dialog when backend is unreachable
  useEffect(() => {
    if (healthStatus === 'unreachable') {
      setShowErrorDialog(true);
    } else if (healthStatus === 'ok' || connected) {
      setShowErrorDialog(false);
    }
  }, [healthStatus, connected]);

  // Check health more frequently to detect when backend comes back online
  useEffect(() => {
    if (!connected && !backendUrl) return;

    // Check health immediately
    checkHealth?.().catch(() => {});

    // Then check periodically
    const interval = setInterval(() => {
      setLastCheckedAt(new Date());
      checkHealth?.().catch(() => {});
    }, 5000); // Check every 5 seconds when disconnected

    return () => clearInterval(interval);
  }, [connected, backendUrl, checkHealth]);

  if (!showErrorDialog) return null;

  return (
    <Dialog onClose={() => {}} closeOnEscape={false} closeOnBackdrop={false}>
      <div style={{
        padding: '24px',
        maxWidth: '400px',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: '48px',
          marginBottom: '16px',
        }}>⚠️</div>

        <h2 style={{
          fontSize: '18px',
          fontWeight: '600',
          marginBottom: '8px',
        }}>Connection Lost</h2>

        <p style={{
          fontSize: '14px',
          color: 'var(--color-text-muted)',
          marginBottom: '16px',
          lineHeight: '1.5',
        }}>
          Unable to reach the backend server at<br />
          <code style={{
            display: 'block',
            marginTop: '8px',
            padding: '8px',
            backgroundColor: 'var(--color-bg-secondary)',
            borderRadius: '4px',
            fontSize: '12px',
            wordBreak: 'break-all',
          }}>{backendUrl || 'unknown'}</code>
        </p>

        {lastCheckedAt && (
          <p style={{
            fontSize: '12px',
            color: 'var(--color-text-muted)',
            marginBottom: '16px',
          }}>
            Last checked: {lastCheckedAt.toLocaleTimeString()}
          </p>
        )}

        <div style={{
          display: 'flex',
          gap: '8px',
          justifyContent: 'center',
        }}>
          <button
            className="btn btn--primary"
            onClick={() => {
              reconnectNow?.();
              checkHealth?.().catch(() => {});
            }}
            style={{ flex: 1 }}
          >
            Retry
          </button>

          <button
            className="btn btn--secondary"
            onClick={() => {
              window.location.href = '/login';
            }}
            style={{ flex: 1 }}
          >
            Change Server
          </button>
        </div>
      </div>
    </Dialog>
  );
}
