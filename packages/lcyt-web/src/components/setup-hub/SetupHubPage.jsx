import { Link } from 'wouter';
import { SetupCard } from './SetupCard.jsx';
import { CaptionTargetsIcon, LanguagesIcon, WorkflowsIcon } from './icons.jsx';
import { CameraSection } from './CameraSection.jsx';
import { MixerSection } from './MixerSection.jsx';
import { EncoderSection } from './EncoderSection.jsx';
import { BridgeSection } from './BridgeSection.jsx';
import { EgressSection } from './EgressSection.jsx';
import { IngestionSection } from './IngestionSection.jsx';
import { WebRadioSection } from './WebRadioSection.jsx';
import { ViewportsSection } from './ViewportsSection.jsx';
import { SttSection } from './SttSection.jsx';
import { StorageSection } from './StorageSection.jsx';
import { AiModelsSection } from './AiModelsSection.jsx';
import { ConnectorsSection } from './ConnectorsSection.jsx';

/**
 * SetupHubPage — `/setup`. Persistent device/service catalog superseding the
 * one-time onboarding wizard as the default destination for this route (the
 * wizard itself is not deleted — reachable below via "Run setup wizard").
 *
 * Styled after the Claude Design mockup (project 9919ac53, Cameras/Mixers/
 * .../ApiConnectorsCard.dc.html + the isProjectConfig screen in
 * Dashboard.dc.html): cards flow into a `repeat(auto-fill, minmax(340px,1fr))`
 * grid instead of one full-width column, and there are no section-title
 * groupings — the mockup uses filter chips instead, which this port doesn't
 * wire up (no favorites/team-defaults concept in this codebase yet).
 *
 * See docs/plans/plan_dashboard_console_redesign.md for the full gap matrix
 * behind each card's status.
 *
 * Deep links: `/setup/:card` (e.g. `/setup/connectors`) renders this same
 * page with the card whose `id` matches `:card` scrolled into view — every
 * card below has an `id` for this reason.
 */
export function SetupHubPage() {
  return (
    <div className="setup-hub-page">
      <div className="setup-hub-page__header">
        <h1 className="setup-hub-page__title">Setup</h1>
        <Link href="/setup/wizard"><a className="btn btn--ghost btn--sm">🧙 Run setup wizard</a></Link>
      </div>
      <p className="setup-hub-page__desc">
        Everything for this project's devices, services, and integrations in one place.
      </p>

      <div className="setup-hub-page__grid">
        {/* ── Production devices ── */}
        <CameraSection />
        <MixerSection />
        <EncoderSection />
        <BridgeSection />

        {/* ── Streaming & graphics ── */}
        <EgressSection />
        <IngestionSection />
        <WebRadioSection />
        <ViewportsSection />

        {/* ── Captions & language ── */}
        <SetupCard
          id="caption-targets"
          icon={CaptionTargetsIcon}
          color="accent"
          title="Caption targets"
          description="YouTube / viewer / generic delivery targets for sent captions."
          status="client-only"
          footerLink={{ label: 'Open in Captions (CC → Targets)', href: '/captions' }}
        />
        <SetupCard
          id="translations"
          icon={LanguagesIcon}
          color="accent"
          title="Languages & translation"
          description="Real-time translation vendor and per-language routing."
          status="client-only"
          footerLink={{ label: 'Open Translations', href: '/translations' }}
        />

        {/* ── Speech & storage ── */}
        <SttSection />
        <StorageSection />

        {/* ── AI & integrations ── */}
        <AiModelsSection />
        <ConnectorsSection />

        {/* ── Placeholder ── */}
        <SetupCard
          id="workflows"
          icon={WorkflowsIcon}
          color="muted"
          title="Workflows"
          description="Automated multi-step actions triggered by events."
          status="soon"
          placeholder
        />
      </div>
    </div>
  );
}
