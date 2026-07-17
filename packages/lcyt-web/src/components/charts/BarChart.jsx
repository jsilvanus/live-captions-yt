/**
 * BarChart — horizontal single-hue bar list (SVG-free; identity is carried by
 * the row label, magnitude by bar length, so one data hue is correct — never
 * one hue per row). Values sit at the bar end in text ink. 4px rounded
 * data-end, 2px row gap; the track is the recessive element.
 *
 * @param {{ items: Array<{ label: string, value: number }>, formatValue?: (v: number) => string, maxRows?: number }} props
 */
export function BarChart({ items = [], formatValue = (v) => String(v), maxRows = 10 }) {
  if (items.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>no data</div>;
  }
  const rows = [...items].sort((a, b) => b.value - a.value).slice(0, maxRows);
  const max = Math.max(...rows.map(r => r.value), 0) || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map(row => (
        <div key={row.label} title={`${row.label}: ${formatValue(row.value)}`}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, 160px) 1fr 70px', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{row.label}</span>
          <div style={{ background: 'color-mix(in srgb, var(--color-border) 40%, transparent)', borderRadius: 4, height: 12 }}>
            <div style={{
              width: `${Math.max(2, (row.value / max) * 100)}%`,
              height: '100%',
              background: 'var(--color-accent-dim, #218bff)',
              borderRadius: 4,
            }} />
          </div>
          <span style={{ textAlign: 'right', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{formatValue(row.value)}</span>
        </div>
      ))}
    </div>
  );
}
