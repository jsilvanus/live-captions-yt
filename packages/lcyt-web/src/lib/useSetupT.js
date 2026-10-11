import { useCallback } from 'react';
import { useLangOptional } from '../contexts/LangContext.jsx';
import { makeSetupT } from './setupText.js';

/** Hook: setup wizard / Setup Hub translator; English outside a LangProvider. */
export function useSetupT() {
  const ctx = useLangOptional();
  const lang = ctx?.lang || 'en';
  return useCallback(makeSetupT(lang), [lang]);
}
