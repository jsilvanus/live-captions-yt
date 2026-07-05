// `use-sync-external-store/shim` only exists to polyfill this hook for React
// <18; this repo requires React ^18.3 (see package.json), which ships the
// hook natively, so re-export straight from `react`. This also avoids
// `createRequire`, which resolves to a Node builtin and breaks when this
// file is bundled for the browser instead of pre-optimized by esbuild.
import { useSyncExternalStore } from 'react';

export { useSyncExternalStore };
export default useSyncExternalStore;
