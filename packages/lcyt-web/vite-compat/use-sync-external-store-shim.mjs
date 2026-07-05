import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const shim = require('use-sync-external-store/cjs/use-sync-external-store-shim.development.js');

// Re-export the named export as ESM so consumers importing the shim path
// receive an ESM-compatible module during Vite optimization.
export const useSyncExternalStore = shim.useSyncExternalStore;
export default shim.useSyncExternalStore;
