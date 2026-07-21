import { useEffect, useRef } from 'react';
import { useToastContext } from '../contexts/ToastContext';
import { getStorageEstimate, WARN_RATIO } from '../lib/storageQuota.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WARNED_KEY = 'lcyt.storageQuotaWarned';

/**
 * StorageQuotaMonitor — plan_ui.md v2 §6d: periodically checks
 * `navigator.storage.estimate()` and warns once (per tab session, via a
 * sessionStorage flag so it doesn't repeat on every check while still over
 * the threshold, but does warn again in a fresh tab) when usage crosses
 * `WARN_RATIO`. Silent watcher, renders nothing — same pattern as
 * `ConnectionStatusMonitor`, mounted once in `SidebarLayout`.
 */
export function StorageQuotaMonitor() {
  const { showToast } = useToastContext();
  const warnedRef = useRef(false);

  useEffect(() => {
    try {
      warnedRef.current = sessionStorage.getItem(WARNED_KEY) === '1';
    } catch { /* sessionStorage unavailable — check every interval instead */ }

    async function check() {
      if (warnedRef.current) return;
      const { ratio } = await getStorageEstimate();
      if (ratio == null || ratio < WARN_RATIO) return;
      warnedRef.current = true;
      try { sessionStorage.setItem(WARNED_KEY, '1'); } catch { /* best effort */ }
      showToast(
        `Browser storage is ${Math.round(ratio * 100)}% full — clear old sent logs or remove unused files to free space.`,
        'warning',
        0,
      );
    }

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
