import { SetupCard } from './SetupCard.jsx';
import { EncodersManager } from '../ProductionEncodersPage.jsx';

/**
 * EncoderSection — embeds the same CRUD logic used at the standalone
 * /production/encoders route (extracted as EncodersManager).
 */
export function EncoderSection() {
  return (
    <SetupCard
      icon="🎛️"
      title="Encoders"
      description="Hardware/software encoder management for outbound streams."
      status="ready"
      action={{ label: 'Open standalone page', href: '/production/devices' }}
    >
      <EncodersManager />
    </SetupCard>
  );
}
