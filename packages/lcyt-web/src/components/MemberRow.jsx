/**
 * MemberRow — one row in the Team tab of ProjectSettingsPage.
 * Shows: email, name, access-level badge, permission chips, remove button.
 */

const LEVEL_COLORS = {
  owner: { bg: '#f5c518', text: '#000' },
  admin: { bg: 'var(--color-primary)', text: '#fff' },
  editor: { bg: '#4a90d9', text: '#fff' },
  operator: { bg: '#7e57c2', text: '#fff' },
  viewer: { bg: 'var(--color-border)', text: 'var(--color-text)' },
  // Legacy value, pre-Phase-0 migration; kept as a defensive fallback only.
  member: { bg: 'var(--color-border)', text: 'var(--color-text)' },
};

const ASSIGNABLE_LEVELS = ['admin', 'editor', 'operator', 'viewer'];

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
  const canChangeLevel = canMutate && member.accessLevel !== 'owner' && !!onChangeLevel;

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
        {canChangeLevel ? (
          <select
            className="settings-field__input"
            value={member.accessLevel}
            onChange={e => onChangeLevel?.(member.userId, e.target.value)}
            style={{ fontSize: 11, fontWeight: 600, width: 'auto', flexShrink: 0 }}
            aria-label={`Access level for ${member.name || member.email}`}
          >
            {ASSIGNABLE_LEVELS.map(level => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        ) : (
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
        )}
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
