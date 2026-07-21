/**
 * PopOutButton — plan_ui.md v2 §4b: "pop out" a panel into a separate
 * browser window. Reuses the existing embed-page infrastructure rather than
 * inventing a new one — `embedPath` is one of the `/embed/*` routes, which
 * already know how to mirror live state over `BroadcastChannel('lcyt-embed')`
 * without owning their own session (see `EmbedSentLogPage.jsx` and
 * `AppProviders.jsx`'s `embed` prop, now also enabled for the main sidebar
 * app in `main.jsx` so a popped-out window has something to listen to).
 */
export function PopOutButton({ embedPath, title = 'Pop out into a separate window', width = 420, height = 640 }) {
  function popOut() {
    const url = new URL(embedPath, window.location.origin);
    window.open(url.toString(), '_blank', `width=${width},height=${height},noopener`);
  }

  return (
    <button type="button" className="pop-out-btn" onClick={popOut} title={title} aria-label={title}>
      ⧉
    </button>
  );
}
