import { useRoute, Link, Redirect } from 'wouter';
import { CamerasManager } from '../ProductionCamerasPage.jsx';
import { MixersManager } from '../ProductionMixersPage.jsx';
import { EncodersManager } from '../ProductionEncodersPage.jsx';
import { BridgesManager } from '../ProductionBridgesPage.jsx';
import { DskViewportsPage } from '../DskViewportsPage.jsx';
import { CaptionTargetsManager } from '../TargetCaptionsPage.jsx';

const PAGES = {
  cameras:  { Manager: CamerasManager,  label: 'Cameras',
    note: 'full feature parity, just as a standalone page.' },
  mixers:   { Manager: MixersManager,   label: 'Mixers',
    note: 'full feature parity, just as a standalone page.' },
  encoders: { Manager: EncodersManager, label: 'Encoders',
    note: 'full feature parity, just as a standalone page.' },
  bridges:  { Manager: BridgesManager,  label: 'Bridges',
    note: 'full feature parity, just as a standalone page.' },
  viewports: { Manager: DskViewportsPage, label: 'Viewports',
    note: 'the full editor — the card covers the basics (name, size, type); text layers and present-to-screen live here.' },
  'caption-targets': { Manager: CaptionTargetsManager, label: 'Caption targets',
    note: 'full feature parity, just as a standalone page.' },
};

/**
 * SetupStandalonePage — `/setup/:card/page`. The full-page equivalent of a
 * Setup Hub card that embeds a device/config manager (Cameras/Mixers/
 * Encoders/Bridges/Caption targets) or a richer standalone editor
 * (Viewports — DskViewportsPage has text-layer/present-to-screen features
 * the card doesn't attempt to replicate). Shown with a banner linking back
 * to the (highlighted) hub card so it's clear the two are the same feature
 * in two presentations, not a separate page.
 *
 * Cards without a real standalone-page equivalent (Egress — `/broadcast`
 * also covers Encoder/YouTube config, not just relay targets; Storage; STT;
 * etc.) don't route here — their footerLink goes straight to whatever
 * existing page actually owns that config.
 */
export function SetupStandalonePage() {
  const [, params] = useRoute('/setup/:card/page');
  const entry = params?.card ? PAGES[params.card] : undefined;

  if (!entry) return <Redirect to="/setup" />;

  const { Manager, label, note } = entry;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="setup-parity-banner">
        Same {label} management as the <Link href={`/setup/${params.card}`}>Setup Hub card</Link> — {note}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Manager />
      </div>
    </div>
  );
}
