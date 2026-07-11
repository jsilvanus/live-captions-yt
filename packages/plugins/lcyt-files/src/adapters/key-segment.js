/**
 * Per-project storage path segment.
 *
 * Every storage adapter (local, S3, WebDAV) isolates a project's files under a
 * per-key directory/prefix so that saving is project-enforced: a session can
 * only ever write beneath its own authenticated api-key's segment. This module
 * is the single source of truth for computing that segment, so all adapters
 * agree byte-for-byte on where a project's files live.
 *
 * The raw api key is not safe to use verbatim as a path component (it may
 * contain characters that are invalid in filenames or S3 keys), so it is
 * sanitized to `[a-zA-Z0-9-]` and bounded in length. That sanitization is
 * lossy — two distinct keys can map to the same sanitized string (e.g. by
 * differing only in stripped characters, or beyond the length bound). When
 * that happens the segment would no longer be a 1:1 mapping and two projects
 * could share a directory. To keep the mapping injective we append a short
 * hash of the *full* raw key whenever sanitization actually altered it.
 *
 * Backward compatibility: for any key that is already safe and within the
 * length bound — which includes every default `randomUUID()` key (36 chars,
 * hex + hyphen) — the sanitized string equals the raw key, so no suffix is
 * added and the segment is identical to the historical `slice(0, 40)` output.
 * Only keys that were previously at risk of collision get the disambiguating
 * suffix.
 */

import { createHash } from 'node:crypto';

/** Max length of the sanitized portion of the segment. */
export const KEY_SEGMENT_MAX = 40;

/**
 * Compute the safe, collision-free path segment for a project api key.
 *
 * @param {string} apiKey
 * @returns {string} A filesystem/S3-safe segment unique to this api key.
 */
export function keySegment(apiKey) {
  const raw = String(apiKey ?? '');
  const safe = raw.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, KEY_SEGMENT_MAX);
  // If sanitization changed nothing, `safe` is already a unique 1:1 encoding.
  if (safe === raw) return safe;
  // Otherwise restore uniqueness with a short hash of the full raw key.
  const suffix = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `${safe}-${suffix}`;
}
