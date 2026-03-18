import { createContext, useContext } from 'react';

/**
 * SessionApiContext — provides stable API methods that don't change with session state.
 *
 * Split from SessionContext so that components doing API calls (stats, files, RTMP,
 * images, icons, relay) are not affected by connection or caption state changes.
 *
 * All methods in this slice access internal refs and are stable across renders
 * (wrapped with useCallback(fn, []) in useSession).
 *
 * Slice: getStats, eraseSelf,
 *        listFiles, getFileDownloadUrl, deleteFile,
 *        uploadImage, listImages, deleteImage, getImageViewUrl, getDskUrl,
 *        listIcons, uploadIcon, deleteIcon,
 *        configureRelay, updateRelay, stopRelaySlot, stopRelay,
 *        getRelayStatus, getRelayHistory, setRelayActive,
 *        getYouTubeConfig
 */
export const SessionApiContext = createContext(null);

export function useSessionApiContext() {
  const ctx = useContext(SessionApiContext);
  if (!ctx) throw new Error('useSessionApiContext must be used within AppProviders');
  return ctx;
}
