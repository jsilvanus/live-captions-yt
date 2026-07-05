import { SetupCard } from './SetupCard.jsx';
import { BridgesManager } from '../ProductionBridgesPage.jsx';

/**
 * BridgeSection — embeds the same CRUD logic used at the standalone
 * /production/bridges route (extracted as BridgesManager).
 */
export function BridgeSection() {
  return (
    <SetupCard
      id="bridges"
      icon="🌉"
      title="Bridges"
      description="On-site agents that relay production commands to physical AV hardware over TCP."
      status="ready"
      action={{ label: 'Open standalone page', href: '/production/bridges' }}
    >
      <BridgesManager />
    </SetupCard>
  );
}
