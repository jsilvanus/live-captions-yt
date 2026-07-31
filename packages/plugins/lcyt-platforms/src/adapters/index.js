/**
 * Adapter registry.
 *
 * Only YouTube is registered. `facebook.js` exists as an interface skeleton
 * (resolved decision #3) and is deliberately absent here — an unregistered
 * adapter cannot be reached by any route, so a request for `/platforms/facebook/...`
 * gets a clean "unsupported platform" rather than a half-working call into
 * unimplemented methods.
 */
import { youtubeAdapter } from './youtube.js';

const ADAPTERS = new Map([
  ['youtube', youtubeAdapter],
]);

/** Platform identifiers this build actually supports. */
export const SUPPORTED_PLATFORMS = Object.freeze([...ADAPTERS.keys()]);

/**
 * @param {string} platform
 * @returns {import('./base.js').PlatformAdapter|null}
 */
export function getAdapter(platform) {
  return ADAPTERS.get(platform) || null;
}

/** @param {string} platform */
export function isSupportedPlatform(platform) {
  return ADAPTERS.has(platform);
}

export { youtubeAdapter };
export { assertAdapterShape, REQUIRED_ADAPTER_METHODS, expiryFromNow } from './base.js';
