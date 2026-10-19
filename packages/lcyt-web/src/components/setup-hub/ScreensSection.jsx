import { useCallback, useEffect, useState } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { ScreensPanel } from '../ScreensPanel.jsx';
import { ViewportsIcon } from './icons.jsx';
import { useSessionContext } from '../../contexts/SessionContext';

/**
 * Setup Hub card: screens on this computer and the DSK viewport shown on each.
 * Reads the viewport list the same way ViewportsSection does; the mapping
 * itself is in the browser (see lib/dskScreens.js).
 */
export function ScreensSection() {
  const session = useSessionContext();
  const backendUrl = session?.backendUrl;
  const apiKey = session?.apiKey;
  const projectToken = session?.projectAccessToken;
  const [viewports, setViewports] = useState([]);
  const [projectSlug, setProjectSlug] = useState(null);

  const load = useCallback(async () => {
    if (!backendUrl || !apiKey) return;
    try {
      const res = await fetch(`${backendUrl}/api/v1/dsk/${encodeURIComponent(apiKey)}/viewports`, {
        headers: projectToken ? { Authorization: `Bearer ${projectToken}` } : {},
      });
      const data = await res.json();
      if (res.ok) {
        setViewports(data.viewports || []);
        setProjectSlug(data.projectSlug ?? null);
      }
    } catch { /* the card shows what it has */ }
  }, [backendUrl, apiKey, projectToken]);

  useEffect(() => { load(); }, [load]);

  return (
    <SetupCard
      id="screens"
      icon={ViewportsIcon}
      color="accent"
      title="Screens"
      description="Screens on this computer and the viewport shown on each one. Chrome or Edge; the mapping is kept in this browser."
      status="ready"
      footerLink={{ label: 'Manage viewports in Graphics → Viewports', href: '/graphics/viewports' }}
    >
      {!apiKey ? (
        <p className="setup-card__empty">Connect to a project to place viewports on screens.</p>
      ) : (
        <ScreensPanel viewports={viewports} projectSlug={projectSlug} apiKey={apiKey} />
      )}
    </SetupCard>
  );
}
