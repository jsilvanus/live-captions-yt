export function isS3Enabled() {
  return !!(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
}

function sanitizeS3KeyPath(keyPath) {
  const normalized = String(keyPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid S3 object key');
  }
  return segments.map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, '-')).join('/');
}

export function buildS3Url(keyPath) {
  const endpoint = process.env.S3_ENDPOINT || '';
  const bucket = process.env.S3_BUCKET || '';
  if (!endpoint || !bucket) throw new Error('S3 not configured');
  const kp = sanitizeS3KeyPath(keyPath);
  return `${endpoint.replace(/\/$/, '')}/${bucket}/${kp}`;
}

export default { isS3Enabled, buildS3Url };
