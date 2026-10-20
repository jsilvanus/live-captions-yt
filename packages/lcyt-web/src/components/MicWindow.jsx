import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MIC_WINDOW_EVENT, openMicWindow } from '../lib/micWindow.js';
import { MicWindowContent } from './MicWindowContent.jsx';

/**
 * Hosts the floating listener window. Renders nothing until opened. The content is a React
 * portal into the PiP window or popup (so it keeps all contexts and the one shared listener),
 * or a fixed in-page bar when neither window type is available.
 */
export function MicWindow() {
  const [host, setHost] = useState(null); // { mode: 'pip'|'popup'|'inline', win?, el }
  const hostRef = useRef(null);

  const close = useCallback(() => {
    const h = hostRef.current;
    hostRef.current = null;
    setHost(null);
    try { if (h?.win && !h.win.closed) h.win.close(); } catch { /* ignore */ }
  }, []);

  const open = useCallback(async () => {
    if (hostRef.current) return;
    hostRef.current = { mode: 'pending' };
    const opened = await openMicWindow();
    let next;
    if (opened) {
      const { win, mode } = opened;
      win.document.title = 'LCYT';
      win.document.body.style.cssText = 'margin:0;background:#111;color:#ddd;font-family:system-ui,sans-serif;';
      win.addEventListener('pagehide', () => { if (hostRef.current?.win === win) { hostRef.current = null; setHost(null); } });
      next = { mode, win, el: win.document.body };
    } else {
      next = { mode: 'inline', el: document.body };
    }
    hostRef.current = next;
    setHost(next);
  }, []);

  useEffect(() => {
    function onRequest(e) {
      const action = e.detail?.action || 'toggle';
      const isOpen = !!hostRef.current;
      if (action === 'close' || (action === 'toggle' && isOpen)) close();
      else if (!isOpen) open();
    }
    window.addEventListener(MIC_WINDOW_EVENT, onRequest);
    return () => { window.removeEventListener(MIC_WINDOW_EVENT, onRequest); close(); };
  }, [open, close]);

  if (!host?.el) return null;
  const inline = host.mode === 'inline';
  return createPortal(
    <div style={inline
      ? { position: 'fixed', right: 12, bottom: 12, width: 340, height: 420, zIndex: 400, border: '1px solid #333', borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,.5)' }
      : { height: '100vh' }}
    >
      <MicWindowContent mode={host.mode} onClose={close} />
    </div>,
    host.el,
  );
}
