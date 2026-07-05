import { SetupCard } from './SetupCard.jsx';
import { MixersManager } from '../ProductionMixersPage.jsx';

/**
 * MixerSection — embeds the same CRUD logic used at the standalone
 * /production/mixers route (extracted as MixersManager).
 */
export function MixerSection() {
  return (
    <SetupCard
      icon="🎚️"
      title="Mixers"
      description="Video mixer source switching: Roland, AMX, ATEM, OBS, LCYT, Monarch HDX."
      status="ready"
      action={{ label: 'Open standalone page', href: '/production/mixers' }}
    >
      <MixersManager />
    </SetupCard>
  );
}
