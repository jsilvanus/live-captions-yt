/**
 * MemberRow — one row in the Members tab of ProjectDetailModal.
 * Shows: email, name, access-level badge, permission chips, remove button.
 */

const LEVEL_COLORS = {
  owner: { bg: '#f5c518', text: '#000' },
  admin: { bg: 'var(--color-primary)', text: '#fff' },
  member: { bg: 'var(--color-border)', text: 'var(--color-text)' },
};

const PERMISSION_LABELS = {
  captioner: 'Captioner',
  'file-manager': 'Files',
  'graphics-editor': 'Graphics editor',
  'graphics-broadcaster': 'Broadcaster',
  'production-operator': 'Operator',
  'stream-manager': 'Streaming',
  'stt-operator': 'STT',
  planner: 'Planner',
  'stats-viewer': 'Stats',
  'device-manager': 'Devices',
  'member-manager': 'Members',
  'settings-manager': 'Settings',
};

export function MemberRow({ member, currentUserAccessLevel, onRemove, onChangeLevel }) {
  const levelStyle = LEVEL_COLORS[member.accessLevel] || LEVEL_COLORS.member;
  const canMutate = currentUserAccessLevel === 'owner' || currentUserAccessLevel === 'admin';
  const canRemove = canMutate && member.accessLevel !== 'owner';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: '10px 12px',
      borderRadius: 6,
      border: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {member.name || member.email}
          </div>
          {member.name && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{member.email}</div>
          )}
        </div>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 7px',
          borderRadius: 10,
          background: levelStyle.bg,
          color: levelStyle.text,
          whiteSpace: 'nowrap',
        }}>
          {member.accessLevel}
        </span>
        {canRemove && (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => onRemove?.(member.userId)}
            style={{ color: 'var(--color-error)', flexShrink: 0 }}
            title="Remove member"
          >
            Remove
          </button>
        )}
      </div>
      {member.permissions?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {member.permissions.map(p => (
            <span key={p} style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 8,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
            }}>
              {PERMISSION_LABELS[p] || p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
