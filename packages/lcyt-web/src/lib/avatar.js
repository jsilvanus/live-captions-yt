const PALETTE = [
  '#2e5fa3', '#7c3aed', '#0891b2', '#c2410c', '#15803d',
  '#be185d', '#4338ca', '#a16207', '#0f766e', '#b91c1c',
];

/** Deterministic avatar color from a string (email/name), for member/user avatar circles. */
export function colorFromString(value) {
  const str = String(value || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Up to 2 initials from a display name, falling back to the email's local part. */
export function initialsFromName(name, email) {
  const source = (name || '').trim() || (email || '').split('@')[0] || '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
