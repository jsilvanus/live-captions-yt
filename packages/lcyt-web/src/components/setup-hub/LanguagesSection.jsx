import { useRef } from 'react';
import { SetupCard } from './SetupCard.jsx';
import { LanguagesIcon } from './icons.jsx';
import { LanguagesManager } from '../LanguagesPage.jsx';

/**
 * LanguagesSection — full add/edit/delete for translation targets, a quick
 * source-language switcher, and the translation provider, matching the
 * Cameras/Mixers/Caption-targets pattern: the manager's own "+ Add" trigger
 * lives in the card's header via ref. Status is `ready` — server-backed via
 * `GET/PUT /translation/config*` (`plan_selfservice_config_backend.md` §1),
 * not localStorage.
 */
export function LanguagesSection() {
  const managerRef = useRef(null);
  return (
    <SetupCard
      id="languages"
      icon={LanguagesIcon}
      color="accent"
      title="Languages"
      description="Source and target languages, translation provider."
      status="ready"
      headerAction={{ label: 'Add', onClick: () => managerRef.current?.openAdd() }}
      footerLink={{ label: 'Open standalone page', href: '/translations' }}
    >
      <LanguagesManager embedded ref={managerRef} />
    </SetupCard>
  );
}
