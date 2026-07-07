import { useState } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { WorkflowsIcon } from './icons.jsx';
import { CameraSection } from './CameraSection.jsx';
import { MixerSection } from './MixerSection.jsx';
import { EncoderSection } from './EncoderSection.jsx';
import { BridgeSection } from './BridgeSection.jsx';
import { EgressSection } from './EgressSection.jsx';
import { IngestionSection } from './IngestionSection.jsx';
import { WebRadioSection } from './WebRadioSection.jsx';
import { ViewportsSection } from './ViewportsSection.jsx';
import { CaptionTargetsSection } from './CaptionTargetsSection.jsx';
import { LanguagesSection } from './LanguagesSection.jsx';
import { SttSection } from './SttSection.jsx';
import { StorageSection } from './StorageSection.jsx';
import { AiModelsSection } from './AiModelsSection.jsx';
import { McpAccessSection } from './McpAccessSection.jsx';
import { ConnectorsSection } from './ConnectorsSection.jsx';
import { useCardFavorites } from '../../lib/cardFavorites.js';
import { useUserAuth } from '../../hooks/useUserAuth.js';
import { useSessionContext } from '../../contexts/SessionContext.jsx';
import { useProjectFeatures } from '../../hooks/useProjectFeatures.js';
import { cardIdsForEnabledFeatures } from '../../lib/workflowFeatureMap.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'workflow', label: 'Workflow' },
];

/**
 * SetupHubPage — `/setup`. Persistent device/service catalog superseding the
 * one-time onboarding wizard as the default destination for this route.
 *
 * Styled after the Claude Design mockup (project 9919ac53, Cameras/Mixers/
 * .../ApiConnectorsCard.dc.html + the isProjectConfig screen in
 * Dashboard.dc.html): cards flow into a `repeat(auto-fill, minmax(340px,1fr))`
 * grid, and a row of filter pills above it — All / Favorites / Workflow —
 * matches the mockup's `setupViewFilterPills` (per-card favorite star buttons
 * live in `SetupCard.jsx`/`lib/cardFavorites.js`; "team defaults" from the
 * mockup is still not wired up — no team/org concept in this codebase yet).
 *
 * "Workflow" filters to the cards relevant to whatever features this project
 * actually has enabled (`lib/workflowFeatureMap.js` maps the Setup Wizard's
 * feature codes to card ids) — driven by the project's real, persisted
 * feature flags rather than a separate "last wizard run" record.
 *
 * See docs/plans/plan_dashboard_console_redesign.md for the full gap matrix
 * behind each card's status.
 *
 * Deep links: `/setup/:card` (e.g. `/setup/connectors`) renders this same
 * page with the card whose `id` matches `:card` scrolled into view — every
 * card below has an `id` for this reason.
 */
export function SetupHubPage() {
  const [filter, setFilter] = useState('all');
  const { favorites } = useCardFavorites();

  const { token: userToken, backendUrl: userBackendUrl } = useUserAuth();
  const session = useSessionContext();
  const apiKey = session?.apiKey || '';
  const backendUrl = userBackendUrl || session?.backendUrl || '';
  const { features } = useProjectFeatures(backendUrl, userToken, apiKey);
  const workflowCardIds = cardIdsForEnabledFeatures(features);

  function isVisible(id) {
    if (filter === 'favorites') return favorites.has(id);
    if (filter === 'workflow') return workflowCardIds.has(id);
    return true;
  }

  return (
    <div className="setup-hub-page">
      <div className="setup-hub-page__header">
        <h1 className="setup-hub-page__title">Setup</h1>
      </div>
      <p className="setup-hub-page__desc">
        Everything for this project's devices, services, and integrations in one place.
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
        {/* ── Production devices ── */}
        {isVisible('cameras') && <CameraSection />}
        {isVisible('mixers') && <MixerSection />}
        {isVisible('encoders') && <EncoderSection />}
        {isVisible('bridges') && <BridgeSection />}

        {/* ── Streaming & graphics ── */}
        {isVisible('egress') && <EgressSection />}
        {isVisible('ingestion') && <IngestionSection />}
        {isVisible('radio') && <WebRadioSection />}
        {isVisible('viewports') && <ViewportsSection />}

        {/* ── Captions & language ── */}
        {isVisible('caption-targets') && <CaptionTargetsSection />}
        {isVisible('languages') && <LanguagesSection />}

        {/* ── Speech & storage ── */}
        {isVisible('stt') && <SttSection />}
        {isVisible('storage') && <StorageSection />}

        {/* ── AI & integrations ── */}
        {isVisible('ai-models') && <AiModelsSection />}
        {isVisible('mcp-access') && <McpAccessSection />}
        {isVisible('connectors') && <ConnectorsSection />}

        {/* ── Workflows — always visible regardless of the active filter
             pill (matches the mockup's own "Workflows (always visible)"
             comment). Now folds in the Setup Wizard directly (replacing both
             the old "Coming soon" placeholder and the page-level wizard
             link) as a solid accent-filled CTA card — a different kind of
             card, signalling "this is an action" rather than a status
             display. ── */}
        <SetupCard
          id="workflows"
          icon={WorkflowsIcon}
          color="accent"
          variant="cta"
          title="Workflows"
          description="Guided, curated setup for a specific goal — pick what you need."
          headerAction={{ label: 'Run setup wizard', href: '/setup/wizard' }}
        />
      </div>
    </div>
  );
}
