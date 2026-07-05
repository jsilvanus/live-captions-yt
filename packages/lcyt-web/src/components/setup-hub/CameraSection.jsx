import { SetupCard } from './SetupCard.jsx';
import { CamerasManager } from '../ProductionCamerasPage.jsx';

/**
 * CameraSection — embeds the same CRUD logic used at the standalone
 * /production/cameras route (extracted as CamerasManager), inside the
 * Setup catalog.
 */
export function CameraSection() {
  return (
    <SetupCard
      id="cameras"
      icon="📷"
      title="Cameras"
      description="PTZ camera control: AMX, VISCA-IP, or browser-based cameras."
      status="ready"
      action={{ label: 'Open standalone page', href: '/production/cameras' }}
    >
      <CamerasManager />
    </SetupCard>
  );
}
