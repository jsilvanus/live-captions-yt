import { useState } from 'react';

/**
 * Sparkline — small single-series time chart (SVG, no dependencies).
 *
 * Single series: no legend (the card title names it); the latest value is the
 * one direct label, in text ink. Data hue comes from --color-accent-dim so the
 * same component is valid on light and dark surfaces. Hover shows a
 * crosshair + tooltip (nearest point).
 *
 * @param {{ points: Array<[string, number]>, height?: number, formatValue?: (v: number) => string }} props
 */
export function Sparkline({ points = [], height = 48, formatValue = (v) => String(v) }) {
  const [hover, setHover] = useState(null);
  const width = 240;
  const pad = 4;

  if (points.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>no data</div>;
  }

  const values = points.map(p => p[1]);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const x = (i) => pad + i * stepX;
  const y = (v) => pad + (height - pad * 2) * (1 - (v - min) / span);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
  const last = points[points.length - 1];

  function onMove(evt) {
    const rect = evt.currentTarget.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * width;
    const i = Math.max(0, Math.min(points.length - 1, Math.round((px - pad) / (stepX || 1))));
    setHover(i);
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height, display: 'block' }}
        role="img"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <path d={areaPath} fill="var(--color-accent-dim, #218bff)" opacity="0.12" />
        <path d={linePath} fill="none" stroke="var(--color-accent-dim, #218bff)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad} y2={height - pad} stroke="var(--color-border)" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(points[hover][1])} r="3.5" fill="var(--color-accent-dim, #218bff)" stroke="var(--color-surface-elevated, #fff)" strokeWidth="2" />
          </>
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
        <span>{hover != null ? points[hover][0] : points[0][0]}</span>
        <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
          {hover != null ? formatValue(points[hover][1]) : formatValue(last[1])}
        </span>
      </div>
    </div>
  );
}
