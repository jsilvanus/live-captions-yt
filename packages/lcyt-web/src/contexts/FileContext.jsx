import { createContext, useContext } from 'react';
import { useFileStore } from '../hooks/useFileStore';

export const FileContext = createContext(null);

/**
 * Provides file store state and methods to the subtree.
 * Accepts all useFileStore callback options as props for external project integration:
 *   onFileLoaded, onFileRemoved, onActiveChanged, onPointerChanged
 */
export function FileProvider({ children, ...opts }) {
  const fileStore = useFileStore(opts);
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
