import { useEffect, useState } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { PlatformsSection } from './PlatformsSection.jsx';
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
import { IconsSection } from './IconsSection.jsx';
import { LanguagesSection } from './LanguagesSection.jsx';
import { SttSection } from './SttSection.jsx';
import { StorageSection } from './StorageSection.jsx';
import { McpAccessSection } from './McpAccessSection.jsx';
import { ConnectorsSection } from './ConnectorsSection.jsx';
import { AiRoleModelsSection } from './AiRoleModelsSection.jsx';
import { useCardFavorites } from '../../lib/cardFavorites.js';
import { useUserAuth } from '../../hooks/useUserAuth.js';
import { useSessionContext } from '../../contexts/SessionContext.jsx';
import { useProjectFeatures } from '../../hooks/useProjectFeatures.js';
import { useProjectRequired } from '../../hooks/useProjectRequired.js';
import { cardIdsForEnabledFeatures, cardReasons } from '../../lib/workflowFeatureMap.js';
import { useSetupT } from '../../lib/useSetupT.js';
import { hasSetupText } from '../../lib/setupText.js';
import { loadCardStatuses } from '../../lib/cardSetupStatus.js';
import { GuidedActionProvider } from '../../hooks/useGuidedAction.jsx';
import { RoleAssistantPanel } from '../agent/RoleAssistantPanel.jsx';

const FILTERS = ['all', 'favorites', 'workflow'];

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
  useProjectRequired();
  const [filter, setFilter] = useState('all');
  const { favorites } = useCardFavorites();

  const { token: userToken, backendUrl: userBackendUrl } = useUserAuth();
  const session = useSessionContext();
  const apiKey = session?.apiKey || '';
  const backendUrl = userBackendUrl || session?.backendUrl || '';
  const { features } = useProjectFeatures(backendUrl, userToken, apiKey);
  const workflowCardIds = cardIdsForEnabledFeatures(features);
  const t = useSetupT();

  // Configured vs enabled: for the Workflow filter, check whether anything is actually set up.
  const [cardStatus, setCardStatus] = useState(new Map());
  const workflowKey = [...workflowCardIds].sort().join(',');
  const sessionToken = session?.getSessionToken?.();
  useEffect(() => {
    if (filter !== 'workflow' || !workflowKey || !session?.connected || !sessionToken) return undefined;
    let cancelled = false;
    loadCardStatuses({ backendUrl: session.backendUrl, token: sessionToken, apiKey, cardIds: workflowKey.split(',') })
      .then(m => { if (!cancelled) setCardStatus(m); });
    return () => { cancelled = true; };
  }, [filter, workflowKey, session?.connected, session?.backendUrl, sessionToken, apiKey]);

  function isVisible(id) {
    if (filter === 'favorites') return favorites.has(id);
    if (filter === 'workflow') return workflowCardIds.has(id);
    return true;
  }

  return (
    <GuidedActionProvider>
      <div className="setup-hub-page-layout">
        <div className="setup-hub-page">
          <div className="setup-hub-page__header">
            <h1 className="setup-hub-page__title">{t('hub.title')}</h1>
          </div>
          <p className="setup-hub-page__desc">
            {t('hub.desc')}
          </p>

          <div className="setup-hub-page__pills">
            {FILTERS.map(f => (
              <button
                key={f}
                type="button"
                className={`setup-hub-page__pill${filter === f ? ' setup-hub-page__pill--active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {t(`hub.filter.${f}`)}
              </button>
            ))}
          </div>

          {filter === 'workflow' && workflowCardIds.size > 0 && (
            <div className="setup-hub-page__desc" data-testid="workflow-reasons" style={{ margin: '0 0 12px' }}>
              {(() => {
                const checked = [...cardStatus.values()].filter(v => v.status !== 'unknown');
                const done = checked.filter(v => v.status === 'configured').length;
                return checked.length > 0 ? <p style={{ margin: '0 0 6px' }}>{t('hub.progress', { done, total: checked.length })}</p> : null;
              })()}
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {[...cardReasons(features)].map(([cardId, codes]) => {
                  const st = cardStatus.get(cardId);
                  return (
                    <li key={cardId}>
                      <a href={`/setup/${cardId}`}>{hasSetupText(`hub.card.${cardId}`) ? t(`hub.card.${cardId}`) : cardId}</a>
                      : {t('hub.neededFor', { features: codes.map(c => t(`feature.${c}`)).join(', ') })}
                      {st && st.status !== 'unknown' && (
                        <strong data-testid={`status-${cardId}`} style={{ marginLeft: 8 }}>
                          {st.status === 'configured' ? '✓ ' + t('hub.status.configured', { count: st.count }) : '○ ' + t('hub.status.empty')}
                        </strong>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

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
            {isVisible('icons') && <IconsSection />}
            {isVisible('languages') && <LanguagesSection />}

            {/* ── Speech & storage ── */}
            {isVisible('stt') && <SttSection />}
            {isVisible('storage') && <StorageSection />}

            {/* ── AI & integrations ── */}
            {isVisible('mcp-access') && <McpAccessSection />}
            {isVisible('connectors') && <ConnectorsSection />}
            {isVisible('broadcast-platforms') && <PlatformsSection />}
            {isVisible('ai-roles') && <AiRoleModelsSection />}

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

        {/* Setup Assistant (plan_ai_roles_framework.md) — chat drives the
            Add/Edit/Delete dialogs of the cards above via useGuidedAction. */}
        <RoleAssistantPanel
          roleCode="setup_assistant"
          title="Setup Assistant"
          subtitle="Describe what you want configured — targets, cameras, mixers — and I'll open the right form filled in."
        />
      </div>
    </GuidedActionProvider>
  );
}
