// NotifyService: the only caller of channel adapters. It applies consent,
// per-contact cooldown and rate limits before any provider call, and it logs
// every attempt. Provider errors are returned as results, never thrown.
//
// See docs/plans/plan_notify_channels.md ("Components" 1 and 4).

import { createCooldown, createRateLimiter } from './rate-limit.js';

/**
 * @typedef {{ slug: string, email?: string|null, smsNumber?: string|null,
 *             consentEmail: boolean, consentSms: boolean, active: boolean }} Contact
 */

/**
 * @param {{
 *   adapters: { email?: { send: Function }, sms?: { send: Function } },
 *   limits?: { perHour?: number, perDay?: number },
 *   cooldownMs?: number,
 *   now?: () => number,
 *   onLog?: (entry: object) => void,
 * }} opts
 */
export function createNotifyService({
  adapters,
  limits = { perHour: 6, perDay: 20 },
  cooldownMs = 60_000,
  now = Date.now,
  onLog = () => {},
}) {
  const hourly = createRateLimiter({ limit: limits.perHour, windowMs: 3_600_000, now });
  const daily = createRateLimiter({ limit: limits.perDay, windowMs: 86_400_000, now });
  const cooldown = createCooldown({ cooldownMs, now });

  /**
   * Send one notification to one contact on one channel.
   * @param {{ channel: 'email'|'sms', contact: Contact, text: string, subject?: string, trigger: 'pointer'|'send'|'manual' }} req
   * @returns {Promise<{ status: string, providerId?: string, error?: string }>}
   */
  async function send({ channel, contact, text, subject = '', trigger }) {
    const base = { at: now(), channel, contactSlug: contact.slug, trigger };
    const finish = (result) => {
      onLog({ ...base, status: result.status, providerId: result.providerId, error: result.error });
      return result;
    };

    if (!contact.active) return finish({ status: 'skipped_inactive' });
    const consented = channel === 'email' ? contact.consentEmail : contact.consentSms;
    if (!consented) return finish({ status: 'skipped_no_consent' });
    const address = channel === 'email' ? contact.email : contact.smsNumber;
    if (!address) return finish({ status: 'skipped_no_address' });
    const adapter = adapters[channel];
    if (!adapter) return finish({ status: 'skipped_no_provider' });

    const key = `${channel}:${contact.slug}`;
    if (!cooldown.take(`${key}:${text}`)) return finish({ status: 'cooldown' });
    // Rate limits count per contact and channel. The hourly window is counted
    // even when the daily window then refuses; the cap is a backstop, so that is acceptable.
    if (!hourly.take(`${key}:h`) || !daily.take(`${key}:d`)) return finish({ status: 'rate_limited' });

    try {
      const payload = channel === 'email'
        ? { to: address, subject: subject || text.slice(0, 80), text }
        : { to: address, text };
      const res = await adapter.send(payload);
      return finish({ status: 'sent', providerId: res?.id });
    } catch (err) {
      return finish({ status: 'failed', error: String(err?.message ?? err).slice(0, 200) });
    }
  }

  return { send };
}
