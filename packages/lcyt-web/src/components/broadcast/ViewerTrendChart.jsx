/**
 * Concurrent-viewer trend — a plain inline SVG sparkline.
 *
 * Deliberately dependency-free: this repo ships no charting library, and one
 * line chart of at most a few hundred points does not justify adding one.
 * The series comes from `broadcast_platform_stats`' live snapshots, which the
 * backend records every poll — so tier 3 of the plan's stats scope ("historical
 * trend") needs no extra storage, just this rendering.
 */
const WIDTH = 480;
const HEIGHT = 90;
const PAD = 4;

export function ViewerTrendChart({ points, title = 'Concurrent viewers' }) {
  // Snapshots taken while the broadcast wasn't actually streaming carry a null
  // viewer count (absent, not zero) — drop them rather than drawing a dip to 0.
  const values = (points || [])
    .map(p => (typeof p.concurrentViewers === 'number' ? p.concurrentViewers : null))
    .filter(v => v !== null);

  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = (WIDTH - PAD * 2) / (values.length - 1);

  const path = values
    .map((v, i) => {
      const x = PAD + i * stepX;
      const y = HEIGHT - PAD - ((v - min) / span) * (HEIGHT - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <figure style={{ margin: '1rem 0 0' }}>
      <figcaption style={{ fontSize: '0.8em', fontWeight: 600, opacity: 0.8, marginBottom: 4 }}>
        {title} — peak {max}
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        // Scales to its container instead of overflowing a narrow panel.
        style={{ width: '100%', maxWidth: WIDTH, height: 'auto', display: 'block' }}
        role="img"
        aria-label={`${title}: ${values.length} samples, peak ${max}, low ${min}`}
      >
        <path
          d={`${path} L${(PAD + (values.length - 1) * stepX).toFixed(1)},${HEIGHT - PAD} L${PAD},${HEIGHT - PAD} Z`}
          fill="var(--accent, #4a7dff)"
          opacity="0.13"
        />
        <path d={path} fill="none" stroke="var(--accent, #4a7dff)" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </figure>
  );
}
