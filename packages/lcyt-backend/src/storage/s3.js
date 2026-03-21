export function isS3Enabled() {
  return !!(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
}

export function buildS3Url(keyPath) {
  const endpoint = process.env.S3_ENDPOINT || '';
  const bucket = process.env.S3_BUCKET || '';
  if (!endpoint || !bucket) throw new Error('S3 not configured');
  // Ensure no leading slash in keyPath
  const kp = keyPath.replace(/^\/+/, '');
  // If endpoint already contains bucket in path, simply join
  return `${endpoint.replace(/\/$/, '')}/${bucket}/${kp}`;
}

export default { isS3Enabled, buildS3Url };
