import { LanguagesManager } from './LanguagesPage.jsx';

/**
 * TranslationsPage — `/translations`, the standalone-page equivalent of the
 * Setup Hub's Languages card (`LanguagesSection.jsx`). Kept as its own route
 * for backward compatibility with existing deep links; the implementation
 * itself now lives entirely in `LanguagesManager` — no duplicate row/state
 * logic here anymore.
 */
export function TranslationsPage() {
  return <LanguagesManager />;
}
