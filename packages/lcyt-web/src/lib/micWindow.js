/**
 * Floating listener window: open/close requests travel as a window event so any control
 * (top bar, Listen pane) can ask without sharing state. `MicWindow` (mounted once in the layout)
 * does the opening, because Document Picture-in-Picture needs the user gesture that is still
 * active while the event is dispatched.
 */
export const MIC_WINDOW_EVENT = 'lcyt:mic-window';

/** @param {'open'|'close'|'toggle'} action */
export function requestMicWindow(action = 'toggle') {
  try { window.dispatchEvent(new CustomEvent(MIC_WINDOW_EVENT, { detail: { action } })); } catch { /* ignore */ }
}

export const MIC_WINDOW_SIZE = { width: 360, height: 440 };

/**
 * Open the best available window, in order: Document Picture-in-Picture (always on top),
 * a small popup, then null (the caller falls back to an in-page floating bar).
 * @returns {Promise<{ mode: 'pip'|'popup', win: Window } | null>}
 */
export async function openMicWindow(w = window) {
  const { width, height } = MIC_WINDOW_SIZE;
  try {
    if (w.documentPictureInPicture?.requestWindow) {
      const win = await w.documentPictureInPicture.requestWindow({ width, height });
      return { mode: 'pip', win };
    }
  } catch { /* denied or unsupported: try a popup */ }
  try {
    const win = w.open('', 'lcyt-listener', `popup=yes,width=${width},height=${height}`);
    if (win && !win.closed) return { mode: 'popup', win };
  } catch { /* blocked */ }
  return null;
}
