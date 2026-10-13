// Database barrel — import everything through here.
// Schema definition and initDb() are in schema.js.

export { initDb, closeDb, getDialect } from './connection.js';

// Domain modules
export { currentDateHour } from './helpers.js';
export * from './users.js';
export * from './keys.js';
export * from './sessions.js';
export * from './sequences.js';
export * from './stats.js';
export * from './usage.js';
export * from './files.js';
export * from './icons.js';
export * from './viewer.js';
export * from './stt.js';

export * from './project-features.js';
export * from './project-members.js';
export * from './device-roles.js';
export * from './caption-targets.js';
export * from './broadcasts.js';
export * from './arming.js';
export * from './videos.js';
export * from './video-feeds.js';
export * from './handoffs.js';
export * from './translation-config.js';
export * from './mcp-tokens.js';
export * from './admin.js';

// Re-export DSK image helpers needed by lcyt-backend routes (keys.js delete cascade)
export { deleteAllImages, safeApiKey } from 'lcyt-dsk';
