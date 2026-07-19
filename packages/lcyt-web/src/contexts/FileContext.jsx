import { createContext, useContext, useEffect, useRef } from 'react';
import { useFileStore } from '../hooks/useFileStore';
import { VariablesContext } from './VariablesContext.jsx';
import { pendingVarBlockNames } from '../lib/metacode-varblocks.js';

export const FileContext = createContext(null);

/**
 * Provides file store state and methods to the subtree.
 * Accepts all useFileStore callback options as props for external project integration:
 *   onFileLoaded, onFileRemoved, onActiveChanged, onPointerChanged
 *
 * VariablesContext is read optionally (via useContext, not the throwing
 * useVariablesContext hook) so FileProvider stays usable standalone by
 * external projects (see README.md) — without it, {{name[N]}} blocks simply
 * don't expand and are left as literal, unresolved text.
 */
export function FileProvider({ children, ...opts }) {
  const variables = useContext(VariablesContext);
  const fileStore = useFileStore({ ...opts, getVariablesSnapshot: variables?.snapshot });

  // {{name[N]}} blocks whose variable hadn't resolved yet at parse time sit as
  // a "loading…" placeholder (varBlockPending). Once the bus delivers that
  // variable's value, re-parse+expand just that file so the block
  // materializes — an already-materialized block is never reflowed here
  // (see metacode-varblocks.js). `variables.variables` gets a new identity on
  // EVERY variable.* SSE event project-wide (e.g. an unrelated constant-poll
  // ticking every second), so this only actually reparses a file when one of
  // its OWN pending variable names is now present in the snapshot — not on
  // every unrelated tick. refreshVarBlocks (not updateFileFromRawText) remaps
  // the pointer by raw source line number, so a block materializing into a
  // different number of virtual lines can't silently move the pointer onto
  // unrelated content underneath the operator.
  const filesRef = useRef(fileStore.files);
  filesRef.current = fileStore.files;
  useEffect(() => {
    if (!variables) return;
    for (const file of filesRef.current) {
      if (file.rawText == null) continue;
      const pending = pendingVarBlockNames(file.lineCodes || []);
      if (pending.length === 0) continue;
      const anyResolved = pending.some((name) => Object.prototype.hasOwnProperty.call(variables.variables, name));
      if (anyResolved) fileStore.refreshVarBlocks(file.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variables?.variables]);

  return (
    <FileContext.Provider value={fileStore}>
      {children}
    </FileContext.Provider>
  );
}

export function useFileContext() {
  const ctx = useContext(FileContext);
  if (!ctx) throw new Error('useFileContext must be used within a FileProvider');
  return ctx;
}
