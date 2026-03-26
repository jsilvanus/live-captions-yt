export function ConnectionDot({ connected }) {
  return (
    <span
      title={connected ? 'Connected' : 'Disconnected'}
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: connected ? 'var(--color-success)' : 'var(--color-text-muted)',
        boxShadow: connected ? '0 0 5px var(--color-success)' : 'none',
      }}
    />
  );
}
