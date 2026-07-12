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
