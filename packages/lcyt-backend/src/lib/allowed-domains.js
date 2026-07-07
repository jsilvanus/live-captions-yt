const DEFAULT_ALLOWED_DOMAINS = 'lcyt.fi,www.lcyt.fi,localhost';

function normalizeDomain(value) {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();
  if (!trimmed) return '';

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(withoutTrailingSlash)
    ? withoutTrailingSlash
    : `https://${withoutTrailingSlash}`;

  try {
    const { hostname, port } = new URL(candidate);
    const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(normalizedHostname);
    const normalizedHost = isLoopback ? 'localhost' : normalizedHostname;
    return port ? `${normalizedHost}:${port}` : normalizedHost;
  } catch {
    return withoutTrailingSlash.toLowerCase();
  }
}

function isLoopbackDomain(value) {
  const normalized = normalizeDomain(value);
  return normalized === 'localhost' || normalized.startsWith('localhost:');
}

export function parseAllowedDomains(raw = process.env.ALLOWED_DOMAINS ?? DEFAULT_ALLOWED_DOMAINS) {
  return raw === '*' ? '*' : raw.split(',').map(d => d.trim()).filter(Boolean);
}

export function isAllowedDomain(domain, raw = process.env.ALLOWED_DOMAINS ?? DEFAULT_ALLOWED_DOMAINS) {
  if (raw === '*') return true;

  const incoming = normalizeDomain(domain);
  if (!incoming) return false;

  const allowedDomains = parseAllowedDomains(raw);
  return allowedDomains.some((allowedDomain) => {
    const normalizedAllowedDomain = normalizeDomain(allowedDomain);
    if (!normalizedAllowedDomain) return false;

    if (normalizedAllowedDomain === incoming) {
      return true;
    }

    if (isLoopbackDomain(incoming) && isLoopbackDomain(allowedDomain)) {
      const incomingHost = incoming.split(':')[0];
      const allowedHost = normalizedAllowedDomain.split(':')[0];
      return incomingHost === allowedHost;
    }

    return false;
  });
}
