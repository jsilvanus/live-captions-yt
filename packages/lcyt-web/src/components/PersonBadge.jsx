import { colorFromString, initialsFromName } from '../lib/avatar.js';

// Shared across TeamPage (org members) and the Admin Users/Projects pages —
// same visual language for "a person" everywhere in the reconciled UI.

export const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  operator: 'Operator',
  viewer: 'Viewer',
};

const ROLE_COLORS = {
  owner:    { bg: 'rgba(46,95,163,0.14)',  color: 'var(--color-primary)' },
  admin:    { bg: 'rgba(46,95,163,0.1)',   color: 'var(--color-primary)' },
  editor:   { bg: 'rgba(124,58,237,0.09)', color: '#7c3aed' },
  operator: { bg: 'rgba(180,83,9,0.1)',    color: '#b45309' },
  viewer:   { bg: 'rgba(8,145,178,0.09)',  color: '#0891b2' },
};

export function RoleBadge({ role }) {
  const c = ROLE_COLORS[role] || { bg: 'var(--color-bg)', color: 'var(--color-text-muted)' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
      padding: '2px 9px', borderRadius: 999, background: c.bg, color: c.color, whiteSpace: 'nowrap',
    }}>
      {ROLE_LABELS[role] || role}
    </span>
  );
}

export function Avatar({ name, email, size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: colorFromString(email || name),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.32, fontWeight: 700, color: '#fff', flexShrink: 0,
    }}>
      {initialsFromName(name, email)}
    </div>
  );
}
