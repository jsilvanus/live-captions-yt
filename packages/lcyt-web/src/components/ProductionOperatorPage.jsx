import { useProjectRequired } from '../hooks/useProjectRequired';
import { useProductionData } from './production/workspace/useProductionData.js';
import { useWorkspaceLayout } from './production/workspace/useWorkspaceLayout.js';
import { ProductionHeader, ViewPills } from './production/workspace/Chrome.jsx';
import { WorkspaceGrid } from './production/workspace/WorkspaceGrid.jsx';
import { C } from './production/workspace/theme.js';

// Production operator control surface — a tileable, view-driven workspace
// (Pre-flight / Live Relay / Live Mixer / Captions + custom views) whose panes
// are wired to the real production/cameras + production/mixers endpoints, DSK
// graphics, cue rules, server-side STT, the RTMP relay, the sent-caption log,
// and the AI production assistant. Layout is persisted per project.
//
// Ported from the Claude Design mockup (project 9919ac53, "Production Page").

export function ProductionOperatorPage() {
  useProjectRequired();
  const D = useProductionData();
  const wl = useWorkspaceLayout(D.creds.apiKey || 'default');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', background: C.pageBg, color: C.text }}>
      <ProductionHeader D={D} />
      <ViewPills wl={wl} />
      {D.error && !D.loaded ? (
        <div style={{ padding: 16, color: C.liveBright, fontSize: '.8rem' }}>Could not load production data: {D.error}</div>
      ) : (
        <WorkspaceGrid D={D} wl={wl} />
      )}
    </div>
  );
}
