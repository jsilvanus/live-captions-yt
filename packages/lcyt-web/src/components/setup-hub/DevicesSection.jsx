import { useRef } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { CamerasIcon } from './icons.jsx';
import { CamerasManager } from '../ProductionCamerasPage.jsx';
import { MixersManager } from '../ProductionMixersPage.jsx';
import { EncodersManager } from '../ProductionEncodersPage.jsx';
import { DeviceFeedLinks } from './DeviceFeedLinks.jsx';
import { useDeviceFeeds } from './useDeviceFeeds.js';
import { useGuidedActionTargets } from '../../hooks/useGuidedAction.jsx';
import { useSessionContext } from '../../contexts/SessionContext.jsx';
import { useSetupT } from '../../lib/useSetupT.js';
import { feedsLinkedTo, linkCandidates } from '../../lib/deviceFeeds.js';

const GROUP_HEADER = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px 4px' };
const GROUP_TITLE = { margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)', flex: 1 };

/** One of the three device groups: heading, a standalone-page link, and the group's own "Add" button. */
function DeviceGroup({ id, title, addLabel, onAdd, standaloneHref, standaloneLabel, children }) {
  return (
    <section aria-labelledby={`devices-${id}`} data-testid={`devices-${id}`}>
      <div style={GROUP_HEADER}>
        <h3 id={`devices-${id}`} style={GROUP_TITLE}>{title}</h3>
        <a href={standaloneHref} style={{ fontSize: 12 }}>{standaloneLabel}</a>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onAdd}>{addLabel}</button>
      </div>
      {children}
    </section>
  );
}

/**
 * DevicesSection: the Setup Hub "Devices" card (`/setup/devices`, plan_feeds_devices.md PR 4). One card for the
 * control schemes: Cameras, Mixers and Encoders, each the same embedded manager as its standalone page. Bridges
 * stay their own card. Every device row also lists the feeds linked to it (live dot, Link feed, Unlink); a
 * feed is linked with PATCH /feeds/:id, and the Feeds card reloads through the lcyt:feeds-changed event.
 */
export function DevicesSection() {
  const session = useSessionContext();
  const t = useSetupT();
  const cameraRef = useRef(null);
  const mixerRef = useRef(null);
  const encoderRef = useRef(null);

  const { feeds, error, link, unlink } = useDeviceFeeds({
    connected: session?.connected,
    backendUrl: session?.backendUrl,
    getSessionToken: session?.getSessionToken,
    projectAccessToken: session?.projectAccessToken,
  });

  // Setup Assistant (plan_ai_roles_framework.md): opens the matching manager's own dialog pre-filled.
  useGuidedActionTargets({
    'camera.create': (args) => cameraRef.current?.openAddPrefilled(args),
    'camera.update': ({ id, ...fields }) => cameraRef.current?.openEditPrefilled(id, fields),
    'camera.delete': ({ id }) => cameraRef.current?.openDeleteConfirm(id),
    'mixer.create': (args) => mixerRef.current?.openAddPrefilled(args),
    'mixer.update': ({ id, ...fields }) => mixerRef.current?.openEditPrefilled(id, fields),
    'mixer.delete': ({ id }) => mixerRef.current?.openDeleteConfirm(id),
  });

  // Each device row gets its linked feeds. Nothing to show until the feed list has loaded.
  function feedLinksFor(deviceType) {
    return device => {
      if (!Array.isArray(feeds)) return null;
      return (
        <DeviceFeedLinks
          linked={feedsLinkedTo(feeds, deviceType, device.id)}
          candidates={linkCandidates(feeds, deviceType, device.id)}
          onLink={feedId => link(feedId, deviceType, device.id)}
          onUnlink={feedId => unlink(feedId)}
        />
      );
    };
  }

  return (
    <SetupCard
      id="devices"
      icon={CamerasIcon}
      color="accent"
      title={t('hub.card.devices')}
      description={t('devices.desc')}
      status="ready"
    >
      {error && (
        <p role="alert" className="setup-card__empty" style={{ color: 'var(--color-error)' }}>
          {t(`devices.err.${error}`)}
        </p>
      )}

      <DeviceGroup
        id="cameras"
        title={t('hub.card.cameras')}
        addLabel={t('devices.add')}
        onAdd={() => cameraRef.current?.openAdd()}
        standaloneHref="/setup/cameras/page"
        standaloneLabel={t('devices.standalone')}
      >
        <CamerasManager embedded ref={cameraRef} renderDeviceFeeds={feedLinksFor('camera')} />
      </DeviceGroup>

      <DeviceGroup
        id="mixers"
        title={t('hub.card.mixers')}
        addLabel={t('devices.add')}
        onAdd={() => mixerRef.current?.openAdd()}
        standaloneHref="/setup/mixers/page"
        standaloneLabel={t('devices.standalone')}
      >
        <MixersManager embedded ref={mixerRef} renderDeviceFeeds={feedLinksFor('mixer')} />
      </DeviceGroup>

      <DeviceGroup
        id="encoders"
        title={t('hub.card.encoders')}
        addLabel={t('devices.add')}
        onAdd={() => encoderRef.current?.openAdd()}
        standaloneHref="/setup/encoders/page"
        standaloneLabel={t('devices.standalone')}
      >
        <EncodersManager embedded ref={encoderRef} renderDeviceFeeds={feedLinksFor('encoder')} />
      </DeviceGroup>
    </SetupCard>
  );
}
