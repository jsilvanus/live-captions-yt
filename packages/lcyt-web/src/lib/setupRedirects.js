/**
 * Setup Hub card paths that moved. `/setup/ingestion` became the Feeds card (PR 3 of the feeds plan);
 * cameras, mixers and encoders became one Devices card (PR 4). The old links (bookmarks, wizard
 * prerequisites) keep working. The standalone pages (`/setup/cameras/page` etc.) are not redirected.
 * Used by main.jsx's router.
 */
export const SETUP_REDIRECTS = [
  { from: '/setup/ingestion', to: '/setup/feeds' },
  { from: '/setup/cameras', to: '/setup/devices' },
  { from: '/setup/mixers', to: '/setup/devices' },
  { from: '/setup/encoders', to: '/setup/devices' },
];
