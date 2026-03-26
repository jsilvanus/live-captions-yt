import React, { useRef, useEffect } from 'react';

// AudioLevelMeter
// Props:
// - analyserRef: React ref object whose .current is an AnalyserNode (optional)
// - extraCanvasRef: ref to an external canvas to also draw into (optional)
// - className: applied to the main canvas
export default function AudioLevelMeter({ analyserRef, extraCanvasRef, className }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;

    function draw() {
      try {
        const analyser = analyserRef?.current;
        if (!analyser) {
          // clear canvases
          const ctx = cvs.getContext('2d');
          ctx.clearRect(0, 0, cvs.width, cvs.height);
          if (extraCanvasRef?.current) {
            try { extraCanvasRef.current.getContext('2d').clearRect(0,0,extraCanvasRef.current.width, extraCanvasRef.current.height); } catch {}
          }
          animRef.current = requestAnimationFrame(draw);
          return;
        }

        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(1, rms * 3);

        for (const target of [cvs, extraCanvasRef?.current].filter(Boolean)) {
          if (!target || !target.clientWidth) continue;
          const w = target.width = target.clientWidth * (window.devicePixelRatio || 1);
          const h = target.height = target.clientHeight * (window.devicePixelRatio || 1);
          const ctx2 = target.getContext('2d');
          ctx2.clearRect(0, 0, w, h);
          ctx2.fillStyle = '#0b8';
          ctx2.fillRect(0, 0, Math.round(w * level), h);
        }
      } catch (e) {
        // swallow
      }
      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
    };
  }, [analyserRef, extraCanvasRef]);

  return (
    <canvas ref={canvasRef} className={className} aria-hidden="true" />
  );
}
