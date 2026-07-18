import { createContext, useContext } from 'react';

// Single app-wide {{ }} variable snapshot (see hooks/useVariables.js), provided
// once in AppProviders so InputBar, CaptionView, and the Production workspace
// all read the same bus-pushed state instead of each opening its own
// GET /variables + /events/stream subscription. See docs/plans/plan_live_variables.md §2.
export const VariablesContext = createContext(null);

export function useVariablesContext() {
  const ctx = useContext(VariablesContext);
  if (!ctx) throw new Error('useVariablesContext must be used within AppProviders');
  return ctx;
}
