import { useRef } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { BridgesIcon } from './icons.jsx';
import { BridgesManager } from '../ProductionBridgesPage.jsx';

/**
 * BridgeSection — embeds the same CRUD logic used at the standalone
 * /production/bridges route (extracted as BridgesManager). See
 * CameraSection for why the "+ Add" button is triggered via ref instead of
 * rendered inline by the manager.
 */
export function BridgeSection() {
  const managerRef = useRef(null);
  return (
    <SetupCard
      id="bridges"
      icon={BridgesIcon}
      color="cyan"
      title="Bridges"
      description="On-site agents that relay production commands to physical AV hardware over TCP."
      status="ready"
      headerAction={{ label: 'Add', onClick: () => managerRef.current?.openAdd() }}
      footerLink={{ label: 'Open standalone page', href: '/setup/bridges/page' }}
    >
      <BridgesManager embedded ref={managerRef} />
    </SetupCard>
  );
}
