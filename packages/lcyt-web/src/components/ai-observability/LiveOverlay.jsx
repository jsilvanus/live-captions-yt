import { useCallback, useEffect, useRef, useState } from 'react';

const BOX_COLOR = '#3ddc84';
const DETECTOR_COLOR = '#4aa3ff';

/** One-line description of the feed attributor's tag, e.g. `Camera choir · visual-match 80%`. */
export function describeSource(tag, cameraNames = {}) {
  if (!tag) return null;
  if (!tag.cameraId) return 'Source unknown';
  const name = cameraNames[tag.cameraId] || tag.cameraId;
  const pct = typeof tag.confidence === 'number' ? ` ${Math.round(tag.confidence * 100)}%` : '';
  return `Camera ${name} · ${tag.method}${pct}`;
}

/**
 * Client-side canvas overlay over the existing polled preview-JPEG feed
 * (plan_ai_observability.md Stage 1 §1): draws `tracker_update` boxes and
 * composites `describer_update` text/JSON on top. No new backend — both
 * events already stream via the role.tracker and role.describer topics on
 * /events/stream; this component only renders what arrives.
 *
 * Perception additions: `detectorSubjects` (blue boxes from the fast detector, labelled with track id and any role a
 * vision model bound to the track) and `sourceTag` (which camera the feed attributor says is on program).
 */
export function LiveOverlay({ previewUrl, trackerObjects, describerUpdate, detectorSubjects, sourceTag, cameraNames }) {
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
    for (const sub of detectorSubjects || []) {
      const bbox = sub.bbox || {};
      const px = (Number(bbox.x) || 0) * width, py = (Number(bbox.y) || 0) * height;
      const pw = (Number(bbox.w) || 0) * width, ph = (Number(bbox.h) || 0) * height;
      ctx.strokeStyle = DETECTOR_COLOR;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(px, py, pw, ph);
      ctx.setLineDash([]);
      const label = `${sub.trackId != null ? `#${sub.trackId} ` : ''}${sub.role || sub.label || 'person'}`;
      const textWidth = ctx.measureText(label).width;
      const labelY = Math.min(height - 15, py + ph);
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(px, labelY, textWidth + 8, 15);
      ctx.fillStyle = DETECTOR_COLOR;
      ctx.fillText(label, px + 4, labelY + 11);
    }
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
  }, [trackerObjects, detectorSubjects]);

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
      {describeSource(sourceTag, cameraNames) && (
        <span data-testid="overlay-source" style={{ position: 'absolute', left: 8, top: 8, background: 'rgba(0,0,0,.72)', color: sourceTag?.cameraId ? '#eee' : '#e8b04a', fontSize: 11, padding: '3px 7px', borderRadius: 5 }}>
          {describeSource(sourceTag, cameraNames)}
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
