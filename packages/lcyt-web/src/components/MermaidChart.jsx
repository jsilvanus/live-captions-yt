import { useEffect, useRef } from 'react';

let mermaidInstance = null;

function getMermaid() {
  if (!mermaidInstance) {
    mermaidInstance = import('mermaid').then(({ default: m }) => {
      m.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'base' });
      return m;
    });
  }
  return mermaidInstance;
}

export function MermaidChart({ chart, style }) {
  const containerRef = useRef(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    getMermaid().then(async (m) => {
      if (cancelled || !containerRef.current) return;
      try {
        const { svg } = await m.render(idRef.current, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          // Make SVG responsive
          const svgEl = containerRef.current.querySelector('svg');
          if (svgEl) {
            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
        }
      } catch (err) {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML =
            `<pre style="color:var(--color-error,#ef4444);font-size:12px;white-space:pre-wrap">Diagram error: ${err.message}</pre>`;
        }
      }
    });

    return () => { cancelled = true; };
  }, [chart]);

  return (
    <div
      ref={containerRef}
      style={{ overflowX: 'auto', maxWidth: '100%', ...style }}
    />
  );
}
