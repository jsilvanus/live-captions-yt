import { createContext, useContext, useEffect, useRef } from 'react';
import { useFileStore } from '../hooks/useFileStore';
import { VariablesContext } from './VariablesContext.jsx';
import { hasVarBlocks } from '../lib/metacode-varblocks.js';

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
  // (see metacode-varblocks.js).
  const filesRef = useRef(fileStore.files);
  filesRef.current = fileStore.files;
  useEffect(() => {
    if (!variables) return;
    for (const file of filesRef.current) {
      if (file.rawText != null && hasVarBlocks(file.lineCodes || [])) {
        fileStore.updateFileFromRawText(file.id, file.rawText);
      }
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
