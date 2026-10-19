// Validation and adapter construction for the Contacts and Contact Providers cards.
// Pure functions, no DB or HTTP here.

import { createBrevoEmailAdapter } from './brevo-email.js';
import { createBrevoSmsAdapter, isValidSmsSender, normalizeRecipient } from './brevo-sms.js';
import { createSmtpEmailAdapter } from './smtp-email.js';

/** Lowercase letters, digits, single hyphens. A metacode writes the slug in brackets. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** Slugs with a meaning of their own, so a person cannot take them. */
export const RESERVED_SLUGS = new Set(['admin', 'all']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PROVIDERS = ['brevo', 'smtp'];

/** Validation error with a message safe to show in the UI (Finnish text is set by the UI layer). */
export class NotifyConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotifyConfigError';
  }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * @param {object} input
 * @returns {{ slug: string, name: string|null, email: string|null, smsNumber: string|null,
 *             consentEmail: boolean, consentSms: boolean, active: boolean }}
 */
export function validateContact(input) {
  const slug = str(input?.slug, 40).toLowerCase();
  if (!SLUG_RE.test(slug)) throw new NotifyConfigError('slug: use lowercase letters, digits and hyphens');
  if (RESERVED_SLUGS.has(slug)) throw new NotifyConfigError(`slug "${slug}" is reserved`);
  const email = str(input?.email, 200) || null;
  if (email && !EMAIL_RE.test(email)) throw new NotifyConfigError('email is not a valid address');
  const rawNumber = str(input?.smsNumber, 30);
  let smsNumber = null;
  if (rawNumber) {
    const digits = normalizeRecipient(rawNumber);
    if (!digits) throw new NotifyConfigError('smsNumber: use the number with country code, e.g. +358 40 123 4567');
    smsNumber = `+${digits}`;
  }
  return {
    slug,
    name: str(input?.name, 120) || null,
    email,
    smsNumber,
    consentEmail: input?.consentEmail === true,
    consentSms: input?.consentSms === true,
    active: input?.active !== false,
  };
}

/**
 * Provider settings. Non-secret fields go to `config`, secrets to `secrets`.
 * brevo: config { senderEmail, senderName?, smsSender }, secrets { apiKey }
 * smtp:  config { host, port, secure?, user?, from }, secrets { pass? }
 * @returns {{ provider: string, config: object, secrets: object }}
 */
export function validateProvider(input) {
  const provider = str(input?.provider, 20);
  if (!PROVIDERS.includes(provider)) throw new NotifyConfigError('provider must be brevo or smtp');
  const c = input?.config ?? {};
  const s = input?.secrets ?? {};
  if (provider === 'brevo') {
    const senderEmail = str(c.senderEmail, 200);
    if (!EMAIL_RE.test(senderEmail)) throw new NotifyConfigError('senderEmail is not a valid address');
    const smsSender = str(c.smsSender, 20);
    if (smsSender && !isValidSmsSender(smsSender)) {
      throw new NotifyConfigError('smsSender: 1-11 letters or digits, or up to 15 digits');
    }
    const apiKey = str(s.apiKey, 300);
    return {
      provider,
      config: { senderEmail, senderName: str(c.senderName, 120) || null, smsSender: smsSender || null },
      secrets: apiKey ? { apiKey } : {},
    };
  }
  const host = str(c.host, 200);
  if (!host) throw new NotifyConfigError('host is required');
  const port = Number(c.port ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new NotifyConfigError('port must be 1-65535');
  const from = str(c.from, 200);
  if (!from) throw new NotifyConfigError('from is required');
  const user = str(c.user, 200) || null;
  const pass = str(s.pass, 300);
  if (!!user !== !!pass) throw new NotifyConfigError('user and password must be set together');
  return {
    provider,
    config: { host, port, secure: c.secure === true || port === 465, user, from },
    secrets: pass ? { pass } : {},
  };
}

/**
 * Build the channel adapters for a stored provider. Brevo offers email and SMS; SMTP offers email only.
 * @returns {{ email?: object, sms?: object }}
 */
export function buildNotifyAdapters(provider, config, secrets, { fetchImpl, transportFactory } = {}) {
  if (provider === 'brevo') {
    const email = createBrevoEmailAdapter({
      apiKey: secrets.apiKey, senderEmail: config.senderEmail, senderName: config.senderName ?? undefined, fetchImpl,
    });
    const adapters = { email };
    if (config.smsSender) {
      adapters.sms = createBrevoSmsAdapter({ apiKey: secrets.apiKey, sender: config.smsSender, fetchImpl });
    }
    return adapters;
  }
  if (provider === 'smtp') {
    return {
      email: createSmtpEmailAdapter({
        host: config.host, port: config.port, secure: config.secure, user: config.user ?? undefined,
        pass: secrets.pass ?? undefined, from: config.from, transportFactory,
      }),
    };
  }
  return {};
}
