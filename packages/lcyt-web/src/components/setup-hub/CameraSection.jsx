import { useRef } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { CamerasIcon } from './icons.jsx';
import { CamerasManager } from '../ProductionCamerasPage.jsx';

/**
 * CameraSection — embeds the same CRUD logic used at the standalone
 * /production/cameras route (extracted as CamerasManager), inside the
 * Setup catalog. The manager's own "+ Add" button is suppressed when
 * embedded; the card's header action triggers it via imperative handle so
 * the button lives in the card's top-right corner like every other card.
 */
export function CameraSection() {
  const managerRef = useRef(null);
  return (
    <SetupCard
      id="cameras"
      icon={CamerasIcon}
      color="accent"
      title="Cameras"
      description="PTZ camera control: AMX, VISCA-IP, or browser-based cameras."
      status="ready"
      headerAction={{ label: 'Add', onClick: () => managerRef.current?.openAdd() }}
      footerLink={{ label: 'Open standalone page', href: '/production/cameras' }}
    >
      <CamerasManager embedded ref={managerRef} />
    </SetupCard>
  );
}
