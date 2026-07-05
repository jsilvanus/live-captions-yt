import { Link, useRoute } from 'wouter';
import { SetupCard } from './SetupCard.jsx';
import { CameraSection } from './CameraSection.jsx';
import { MixerSection } from './MixerSection.jsx';
import { EncoderSection } from './EncoderSection.jsx';
import { BridgeSection } from './BridgeSection.jsx';
import { SttSection } from './SttSection.jsx';
import { StorageSection } from './StorageSection.jsx';
import { AiModelsSection } from './AiModelsSection.jsx';
import { ConnectorsSection } from './ConnectorsSection.jsx';

/**
 * SetupHubPage — `/setup`. Persistent device/service catalog superseding the
 * one-time onboarding wizard as the default destination for this route (the
 * wizard itself is not deleted — reachable below via "Run setup wizard").
 *
 * See docs/plans/plan_dashboard_console_redesign.md for the full gap matrix
 * behind each card's status.
 *
 * Deep links: `/setup/:card` (e.g. `/setup/connectors`) renders this same
 * page with that card pre-expanded and scrolled into view, so other pages
 * can link straight to a specific card's settings without duplicating its
 * UI on a standalone route.
 */
export function SetupHubPage() {
  const [matchConnectors] = useRoute('/setup/connectors');

  return (
    <div className="setup-hub-page">
      <div className="setup-hub-page__header">
        <h1 className="setup-hub-page__title">Setup</h1>
        <Link href="/setup/wizard"><a className="btn btn--ghost btn--sm">🧙 Run setup wizard</a></Link>
      </div>
      <p className="setup-hub-page__desc">
        Everything for this project's devices, services, and integrations in one place.
        Cards you can expand have real, working configuration; disabled cards are
        visible so you know what's planned but not built yet.
      </p>

      <div className="setup-hub-page__section-title">Production devices</div>
      <div className="setup-hub-page__grid">
        <CameraSection />
        <MixerSection />
        <EncoderSection />
        <BridgeSection />
      </div>

      <div className="setup-hub-page__section-title">Streaming &amp; graphics</div>
      <div className="setup-hub-page__grid">
        <SetupCard
          icon="📡"
          title="Egress (stream targets)"
          description="YouTube / generic RTMP relay targets — 4-slot configuration."
          status="ready"
          action={{ label: 'Manage in Broadcast → Settings', href: '/broadcast' }}
        />
        <SetupCard
          icon="🎬"
          title="Ingestion"
          description="Incoming RTMP status. No dedicated ingestion entity exists yet — this reflects the ingest feature flag only."
          status="partial"
          statusLabel="Status only"
        />
        <SetupCard
          icon="📻"
          title="Web radio"
          description="Audio-only HLS output. Read-only status today; there's no config UI for it yet."
          status="partial"
          statusLabel="Status only"
        />
        <SetupCard
          icon="🖼️"
          title="Viewports"
          description="Named DSK display regions (e.g. vertical-left, landscape)."
          status="ready"
          action={{ label: 'Manage in Graphics → Viewports', href: '/graphics/viewports' }}
        />
      </div>

      <div className="setup-hub-page__section-title">Captions &amp; language</div>
      <div className="setup-hub-page__grid">
        <SetupCard
          icon="🎯"
          title="Caption targets"
          description="YouTube / viewer / generic delivery targets for sent captions."
          status="client-only"
          action={{ label: 'Open in Captions (CC → Targets)', href: '/captions' }}
        >
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
            This configuration lives in your browser's local storage only — it
            is not synced server-side yet.
          </p>
        </SetupCard>
        <SetupCard
          icon="🌐"
          title="Languages &amp; translation"
          description="Real-time translation vendor and per-language routing."
          status="client-only"
          action={{ label: 'Open Translations', href: '/translations' }}
        >
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
            This configuration lives in your browser's local storage only — it
            is not synced server-side yet.
          </p>
        </SetupCard>
      </div>

      <div className="setup-hub-page__section-title">Speech &amp; storage</div>
      <div className="setup-hub-page__grid">
        <SttSection />
        <StorageSection />
      </div>

      <div className="setup-hub-page__section-title">AI &amp; integrations</div>
      <div className="setup-hub-page__grid">
        <AiModelsSection />
        <ConnectorsSection autoExpand={matchConnectors} />
        <SetupCard
          icon="🧩"
          title="Workflows"
          description="Automated multi-step actions triggered by events."
          status="soon"
          disabled
        />
      </div>
    </div>
  );
}
