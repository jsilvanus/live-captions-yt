import { useRef } from 'react';

export function FloatingPanel({ title, onClose, children }) {
  const panelRef = useRef(null);
  const posRef = useRef({ x: Math.max(20, window.innerWidth - 400), y: 80 });

  function onDragStart(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX - posRef.current.x;
    const startY = e.clientY - posRef.current.y;

    function onMove(me) {
      posRef.current = { x: me.clientX - startX, y: me.clientY - startY };
      if (panelRef.current) {
        panelRef.current.style.left = posRef.current.x + 'px';
        panelRef.current.style.top = posRef.current.y + 'px';
        panelRef.current.style.right = 'auto';
      }
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  return (
    <div
      className="floating-panel"
      ref={panelRef}
      role="dialog"
      aria-label={title}
      style={{ top: posRef.current.y, left: posRef.current.x, right: 'auto' }}
    >
      <div className="floating-panel__header" onPointerDown={onDragStart}>
        <span className="floating-panel__title">{title}</span>
        <button className="floating-panel__close btn" onClick={onClose} onPointerDown={e => e.stopPropagation()} title="Close" aria-label="Close">✕</button>
      </div>
      <div className="floating-panel__body">
        {children}
      </div>
    </div>
  );
}
