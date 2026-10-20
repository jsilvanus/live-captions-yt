/**
 * The quick workflows, in list order. `path` is relative to the `/quick` base; `popup` is the pop-out window size.
 * Adding a workflow: add it here, add `quick.workflow.<id>.title|desc` to all three locales, and a route in QuickApp.
 */
export const QUICK_WORKFLOWS = Object.freeze([
  { id: 'captions', path: '/captions', popup: { width: 440, height: 760 } },
  { id: 'restream', path: '/restream', popup: { width: 460, height: 760 } },
]);

/** window.open features for a workflow's pop-out window. */
export function popupFeatures(workflow) {
  return `popup=yes,width=${workflow.popup.width},height=${workflow.popup.height}`;
}

/** Opens the workflow in its own small window; returns false when the browser blocked it. */
export function openWorkflowWindow(workflow, open = window.open.bind(window)) {
  const win = open(`/quick${workflow.path}`, `lcyt-quick-${workflow.id}`, popupFeatures(workflow));
  if (!win) return false;
  try { win.focus(); } catch { /* ignore */ }
  return true;
}
