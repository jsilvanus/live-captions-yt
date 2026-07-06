import { useRef } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { MixersIcon } from './icons.jsx';
import { MixersManager } from '../ProductionMixersPage.jsx';

/**
 * MixerSection — embeds the same CRUD logic used at the standalone
 * /production/mixers route (extracted as MixersManager). See CameraSection
 * for why the "+ Add" button is triggered via ref instead of rendered
 * inline by the manager.
 */
export function MixerSection() {
  const managerRef = useRef(null);
  return (
    <SetupCard
      id="mixers"
      icon={MixersIcon}
      color="accent"
      title="Mixers"
      description="Video mixer source switching: Roland, AMX, ATEM, OBS, LCYT, Monarch HDX."
      status="ready"
      headerAction={{ label: 'Add', onClick: () => managerRef.current?.openAdd() }}
      footerLink={{ label: 'Open standalone page', href: '/setup/mixers/page' }}
    >
      <MixersManager embedded ref={managerRef} />
    </SetupCard>
  );
}
