import { createContext, useContext } from 'react';

// Single app-wide {{ }} variable snapshot (see hooks/useVariables.js), provided
// once in AppProviders so InputBar, CaptionView, and the Production workspace
// all read the same bus-pushed state instead of each opening its own
// GET /variables + /events/stream subscription. See docs/plans/plan_live_variables.md §2.
export const VariablesContext = createContext(null);

// Returned by useVariablesContext() when no <VariablesContext.Provider> is
// present — matches this app's existing standalone-usable convention for
// this context (FileContext.jsx, CaptionView.jsx already read it optionally
// via useContext and degrade gracefully) rather than crashing external/embed
// integrators who compose providers manually without VariablesContext (see
// README.md's "Manual provider wiring" section, which predates this context).
const NOOP_VARIABLES = {
  variables: {},
  snapshot: () => ({}),
  refresh: async () => null,
  writeFileCode: async () => null,
};

/** Never throws — falls back to a no-op snapshot standalone, same as reading VariablesContext via useContext directly. */
export function useVariablesContext() {
  return useContext(VariablesContext) || NOOP_VARIABLES;
}
