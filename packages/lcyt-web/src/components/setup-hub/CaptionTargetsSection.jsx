import { useRef } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { CaptionTargetsIcon } from './icons.jsx';
import { CaptionTargetsManager } from '../TargetCaptionsPage.jsx';

/**
 * CaptionTargetsSection — embeds the same full add/edit/delete CRUD used at
 * the standalone `/setup/caption-targets/page` route (extracted as
 * `CaptionTargetsManager`), matching the Cameras/Mixers/Encoders/Bridges
 * pattern: the manager's own "+ Add" trigger lives in the card's header via
 * ref, not rendered inline by the manager. See `CaptionTargetsManager` for
 * the full field set (reuses `TargetRow.jsx`, the same editor `TargetsPanel`/
 * `CCModal` use for the localStorage-only config).
 */
export function CaptionTargetsSection() {
  const managerRef = useRef(null);
  return (
    <SetupCard
      id="caption-targets"
      icon={CaptionTargetsIcon}
      color="accent"
      title="Caption targets"
      description="Where captions are delivered (YouTube, generic RTMP/HTTP, viewer)."
      status="ready"
      headerAction={{ label: 'Add', onClick: () => managerRef.current?.openAdd() }}
      footerLink={{ label: 'Open standalone page', href: '/setup/caption-targets/page' }}
    >
      <CaptionTargetsManager embedded ref={managerRef} />
    </SetupCard>
  );
}
