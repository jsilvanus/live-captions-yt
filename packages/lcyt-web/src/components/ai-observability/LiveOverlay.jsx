import { useCallback, useEffect, useRef, useState } from 'react';

const BOX_COLOR = '#3ddc84';

/**
 * Client-side canvas overlay over the existing polled preview-JPEG feed
 * (plan_ai_observability.md Stage 1 §1): draws `tracker_update` boxes and
 * composites `describer_update` text/JSON on top. No new backend — both
 * events already stream via the role.tracker and role.describer topics on
 * /events/stream; this component only renders what arrives.
 */
export function LiveOverlay({ previewUrl, trackerObjects, describerUpdate }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [imgSize, setImgSize] = useState(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.font = '11px monospace';
    for (const obj of trackerObjects || []) {
      const bbox = obj.bbox || {};
      const x = Number(bbox.x) || 0, y = Number(bbox.y) || 0, w = Number(bbox.w) || 0, h = Number(bbox.h) || 0;
      const px = x * width, py = y * height, pw = w * width, ph = h * height;
      ctx.strokeStyle = BOX_COLOR;
      ctx.strokeRect(px, py, pw, ph);
      const conf = typeof obj.confidence === 'number' ? ` ${(obj.confidence * 100).toFixed(0)}%` : '';
      const label = `${obj.label || 'object'}${conf}`;
      const textWidth = ctx.measureText(label).width;
      const labelY = Math.max(0, py - 15);
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(px, labelY, textWidth + 8, 15);
      ctx.fillStyle = BOX_COLOR;
      ctx.fillText(label, px + 4, labelY + 11);
    }
  }, [trackerObjects]);

  useEffect(() => { draw(); }, [draw, imgSize]);

  useEffect(() => {
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [draw]);

  const inW = imgSize?.w, inH = imgSize?.h;
  const describerText = describerUpdate?.text
    || (describerUpdate?.json ? JSON.stringify(describerUpdate.json) : null);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative', width: '100%', maxWidth: 760, margin: '0 auto',
        aspectRatio: inW && inH ? `${inW} / ${inH}` : '16 / 9',
        background: '#0c0c0c', borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--color-border)',
      }}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt="Live preview"
          onLoad={(e) => setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#777', fontSize: 12 }}>
          no incoming preview yet
        </span>
      )}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      {describerText && (
        <div style={{
          position: 'absolute', left: 8, right: 8, bottom: 8, maxHeight: '38%', overflow: 'auto',
          background: 'rgba(0,0,0,.72)', color: '#eee', fontSize: 12, lineHeight: 1.4, padding: '6px 9px', borderRadius: 6,
        }}>
          {describerText}
        </div>
      )}
    </div>
  );
}
