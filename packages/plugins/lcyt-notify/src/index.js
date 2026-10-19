// Public surface of the notify plugin: the service, its limits, the channel adapters, the routes and storage.
export { createNotifyService } from './notify-service.js';
export { createRateLimiter, createCooldown } from './rate-limit.js';
export { createBrevoEmailAdapter } from './brevo-email.js';
export { createBrevoSmsAdapter, isValidSmsSender, normalizeRecipient } from './brevo-sms.js';
export { createSmtpEmailAdapter } from './smtp-email.js';
export { createNotifyRouter, loadNotifyAdapters } from './routes.js';
export { validateContact, validateProvider, buildNotifyAdapters, NotifyConfigError } from './config.js';
export { listContacts, getContact, saveContact, deleteContact, listLog, purgeLog, appendLog } from './db.js';
