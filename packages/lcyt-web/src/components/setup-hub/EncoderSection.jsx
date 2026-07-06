import { useRef } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { EncodersIcon } from './icons.jsx';
import { EncodersManager } from '../ProductionEncodersPage.jsx';

/**
 * EncoderSection — embeds the same CRUD logic used at the standalone
 * /production/encoders route (extracted as EncodersManager). See
 * CameraSection for why the "+ Add" button is triggered via ref instead of
 * rendered inline by the manager.
 */
export function EncoderSection() {
  const managerRef = useRef(null);
  return (
    <SetupCard
      id="encoders"
      icon={EncodersIcon}
      color="accent"
      title="Encoders"
      description="Hardware/software encoder management for outbound streams."
      status="ready"
      headerAction={{ label: 'Add', onClick: () => managerRef.current?.openAdd() }}
      footerLink={{ label: 'Open standalone page', href: '/production/devices' }}
    >
      <EncodersManager embedded ref={managerRef} />
    </SetupCard>
  );
}
