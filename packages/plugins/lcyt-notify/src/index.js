// Public surface of the notify plugin: the service, its limits and the channel adapters.
export { createNotifyService } from './notify-service.js';
export { createRateLimiter, createCooldown } from './rate-limit.js';
export { createBrevoEmailAdapter } from './brevo-email.js';
export { createNotifyRouter, loadNotifyAdapters } from './routes.js';
export { validateContact, validateProvider, buildNotifyAdapters, NotifyConfigError } from './config.js';
export { listContacts, getContact, saveContact, deleteContact, listLog, purgeLog, appendLog } from './db.js';
