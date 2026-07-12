/**
 * Parse a bare duration string to milliseconds, shared by the `timer:` metacode
 * and the `=>` TTL annotation so both speak the same unit vocabulary.
 *
 *   parseDuration('5')            → 5000   (defaultUnit 's')
 *   parseDuration('500ms')        → 500
 *   parseDuration('2m')           → 120000
 *   parseDuration('0') / bad input → null
 *
 * Units: `ms` | `s` | `m`. (No `c`/captions — a duration is wall-clock only; the
 * caption-count unit is meaningful for a variable TTL, not for a playback timer.)
 *
 * @param {string|number} raw
 * @param {{ defaultUnit?: 'ms'|'s'|'m' }} [opts]
 * @returns {number|null} milliseconds, or null if not a positive duration
 */
export function parseDuration(raw, { defaultUnit = 's' } = {}) {
  const m = String(raw ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/);
  if (!m) return null;
  const count = parseFloat(m[1]);
  if (!Number.isFinite(count) || count <= 0) return null;
  const unit = m[2] || defaultUnit;
  if (unit === 'ms') return Math.round(count);
  if (unit === 's') return Math.round(count * 1000);
  if (unit === 'm') return Math.round(count * 60000);
  return null;
}

/**
 * Parse a `=>` TTL/expiry annotation off a metacode value.
 * Pure — see docs/plans/plan_metacode_variable_unification.md 'Variable TTL / expiry'.
 */
export function parseValueTtl(rawValue) {
  // Guard against null/undefined input
  if (rawValue == null) {
    rawValue = '';
  }

  const regex = /\s*=>\s*(\d+(?:\.\d+)?)\s*(ms|s|m|c)(?:\s*:\s*([\s\S]*?))?\s*$/;
  const match = rawValue.match(regex);

  // If no match, return value as-is (trim it) with no TTL
  if (!match) {
    return {
      value: rawValue.trim(),
      ttl: null
    };
  }

  const count = parseFloat(match[1]);
  const unit = match[2];
  const revertSpec = match[3];

  // Check if count is finite and > 0
  if (!Number.isFinite(count) || count <= 0) {
    return {
      value: rawValue.trim(),
      ttl: null
    };
  }

  // Convert unit to ms or captions
  let ms = null;
  let captions = null;

  switch (unit) {
    case 'ms':
      ms = Math.round(count);
      break;
    case 's':
      ms = Math.round(count * 1000);
      break;
    case 'm':
      ms = Math.round(count * 60000);
      break;
    case 'c':
      captions = Math.max(1, Math.round(count));
      break;
  }

  // Determine revert mode and value
  let revertMode = 'baseline';
  let revertValue = null;

  if (revertSpec !== undefined) {
    const trimmedSpec = revertSpec.trim();
    if (trimmedSpec === '~') {
      revertMode = 'previous';
    } else {
      revertMode = 'literal';
      revertValue = trimmedSpec;
    }
  }

  // Extract the value (everything before the match)
  const value = rawValue.slice(0, match.index).trim();

  return {
    value,
    ttl: {
      ms,
      captions,
      revertMode,
      revertValue
    }
  };
}
