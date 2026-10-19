/**
 * Setup Hub card paths that moved. `/setup/ingestion` became the Feeds card (PR 3 of the feeds plan);
 * the old links (bookmarks, wizard prerequisites) keep working. Used by main.jsx's router.
 */
export const SETUP_REDIRECTS = [
  { from: '/setup/ingestion', to: '/setup/feeds' },
];
