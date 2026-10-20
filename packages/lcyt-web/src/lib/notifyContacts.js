/**
 * Pure helpers for the Setup Hub "Contact" card (notify contacts and provider).
 * Backend: packages/plugins/lcyt-notify/src/routes.js and config.js (the server validates again).
 */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const RESERVED_SLUGS = ['admin', 'all'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Loose pre-check; the server normalises. Needs a country code, 8-15 digits. */
const PHONE_RE = /^\+?[0-9 ()-]{8,25}$/;

export const EMPTY_CONTACT_FORM = {
  slug: '', name: '', email: '', smsNumber: '', consentEmail: false, consentSms: false, active: true,
};

export function contactToForm(c) {
  return {
    slug: c.slug, name: c.name || '', email: c.email || '', smsNumber: c.smsNumber || '',
    consentEmail: !!c.consentEmail, consentSms: !!c.consentSms, active: c.active !== false,
  };
}

/** Body of PUT /notify/contacts/:slug (the slug travels in the path). */
export function contactBody(f) {
  return {
    name: f.name.trim(), email: f.email.trim(), smsNumber: f.smsNumber.trim(),
    consentEmail: !!f.consentEmail, consentSms: !!f.consentSms, active: f.active !== false,
  };
}

/** @returns {string|null} an i18n key suffix under contact.err.*, or null when fine */
export function validateContactForm(f, { isNew = true } = {}) {
  const slug = f.slug.trim().toLowerCase();
  if (isNew) {
    if (!SLUG_RE.test(slug)) return 'slug';
    if (RESERVED_SLUGS.includes(slug)) return 'reserved';
  }
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) return 'email';
  if (f.smsNumber.trim() && !PHONE_RE.test(f.smsNumber.trim())) return 'phone';
  return null;
}

/**
 * Channels that have an address but no consent (so nothing will be sent there),
 * and channels with consent but no address.
 * @returns {{ noConsent: Array<'email'|'sms'>, noAddress: Array<'email'|'sms'> }}
 */
export function consentIssues(c) {
  const noConsent = [], noAddress = [];
  if (c.email && !c.consentEmail) noConsent.push('email');
  if (c.smsNumber && !c.consentSms) noConsent.push('sms');
  if (c.consentEmail && !c.email) noAddress.push('email');
  if (c.consentSms && !c.smsNumber) noAddress.push('sms');
  return { noConsent, noAddress };
}

export const EMPTY_PROVIDER_FORM = {
  provider: 'brevo',
  senderEmail: '', senderName: '', smsSender: '', apiKey: '',
  host: '', port: '587', secure: false, user: '', from: '', pass: '',
};

export function providerToForm(p) {
  const f = { ...EMPTY_PROVIDER_FORM };
  if (!p?.configured) return f;
  const c = p.config || {};
  f.provider = p.provider;
  if (p.provider === 'brevo') {
    f.senderEmail = c.senderEmail || ''; f.senderName = c.senderName || ''; f.smsSender = c.smsSender || '';
  } else {
    f.host = c.host || ''; f.port = String(c.port ?? 587); f.secure = !!c.secure; f.user = c.user || ''; f.from = c.from || '';
  }
  return f;
}

/** Body of PUT /notify/provider. Secrets are sent only when typed (empty keeps the stored ones). */
export function providerBody(f) {
  if (f.provider === 'brevo') {
    return {
      provider: 'brevo',
      config: { senderEmail: f.senderEmail.trim(), senderName: f.senderName.trim(), smsSender: f.smsSender.trim() },
      secrets: f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {},
    };
  }
  return {
    provider: 'smtp',
    config: { host: f.host.trim(), port: Number(f.port) || 587, secure: !!f.secure, user: f.user.trim(), from: f.from.trim() },
    secrets: f.pass ? { pass: f.pass } : {},
  };
}

/** @param {object|null} previous the GET /notify/provider answer @returns {string|null} error key under contact.err.* */
export function validateProviderForm(f, previous) {
  const changedProvider = !previous?.configured || previous.provider !== f.provider;
  if (f.provider === 'brevo') {
    if (!EMAIL_RE.test(f.senderEmail.trim())) return 'senderEmail';
    if (changedProvider && !f.apiKey.trim()) return 'secret';
    return null;
  }
  if (!f.host.trim()) return 'host';
  const port = Number(f.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'port';
  if (!f.from.trim()) return 'from';
  // The server needs user and password together in the same request (an empty password cannot keep the stored one).
  if (!!f.user.trim() !== !!f.pass) return 'userPass';
  return null;
}

/** Channels the saved provider can send on. SMS needs Brevo with an SMS sender. */
export function providerChannels(p) {
  if (!p?.configured) return [];
  if (p.provider === 'brevo') return p.config?.smsSender ? ['email', 'sms'] : ['email'];
  return ['email'];
}
