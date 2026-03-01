import { app, db, store } from './server.js';
import { cleanRevokedKeys } from './db.js';

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Revoked key cleanup
// ---------------------------------------------------------------------------

const REVOKED_KEY_TTL_DAYS = Number(process.env.REVOKED_KEY_TTL_DAYS ?? 30);
const REVOKED_KEY_CLEANUP_INTERVAL = Number(process.env.REVOKED_KEY_CLEANUP_INTERVAL ?? 86_400_000);

if (REVOKED_KEY_TTL_DAYS > 0) {
  const cleanupTimer = setInterval(() => {
    const { count } = cleanRevokedKeys(db, REVOKED_KEY_TTL_DAYS);
    if (count > 0) console.log(`[cleanup] Purged ${count} revoked key(s) older than ${REVOKED_KEY_TTL_DAYS} days`);
  }, REVOKED_KEY_CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log('Shutting down...');
  for (const session of store.all()) {
    try { await session.sender.end(); } catch {}
  }
  store.stopCleanup();
  db.close();
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
