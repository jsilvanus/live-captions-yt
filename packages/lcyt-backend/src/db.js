// Barrel re-export — all db functions are now in src/db/ domain modules.
// This file preserves backward compatibility so existing imports from '../db.js' still work.
export * from './db/index.js';
