// Storage for the notify tables (notify_contacts, notify_providers, notify_log).
// Every function takes the Prisma client of lcyt-backend and returns plain objects.
// Booleans are stored as 0/1 integers, timestamps as 'YYYY-MM-DD HH:MM:SS' text.

import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const flag = (b) => (b ? 1 : 0);

export function serializeContact(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name ?? null,
    email: row.email ?? null,
    smsNumber: row.sms_number ?? null,
    consentEmail: row.consent_email === 1,
    consentSms: row.consent_sms === 1,
    active: row.active === 1,
    updatedAt: row.updated_at,
  };
}

/** @param {object} db Prisma client */
export async function listContacts(db, apiKey) {
  const rows = await db.notify_contacts.findMany({ where: { api_key: apiKey }, orderBy: { slug: 'asc' } });
  return rows.map(serializeContact);
}

export async function getContact(db, apiKey, slug) {
  const row = await db.notify_contacts.findUnique({ where: { api_key_slug: { api_key: apiKey, slug } } });
  return row ? serializeContact(row) : null;
}

/** @returns {Promise<{ contact: object, created: boolean }>} */
export async function saveContact(db, apiKey, contact) {
  const existing = await db.notify_contacts.findUnique({ where: { api_key_slug: { api_key: apiKey, slug: contact.slug } } });
  const data = {
    name: contact.name, email: contact.email, sms_number: contact.smsNumber,
    consent_email: flag(contact.consentEmail), consent_sms: flag(contact.consentSms),
    active: flag(contact.active), updated_at: now(),
  };
  if (existing) {
    await db.notify_contacts.update({ where: { id: existing.id }, data });
  } else {
    await db.notify_contacts.create({ data: { id: randomUUID(), api_key: apiKey, slug: contact.slug, ...data } });
  }
  return { contact: await getContact(db, apiKey, contact.slug), created: !existing };
}

export async function deleteContact(db, apiKey, slug) {
  const res = await db.notify_contacts.deleteMany({ where: { api_key: apiKey, slug } });
  return res.count > 0;
}

/** Provider settings of a project. secrets_enc is returned only so the route can decrypt it. */
export async function getProviderRow(db, apiKey) {
  return (await db.notify_providers.findUnique({ where: { api_key: apiKey } })) ?? null;
}

export async function saveProviderRow(db, apiKey, { provider, configJson, secretsEnc }) {
  const data = { provider, config_json: configJson, secrets_enc: secretsEnc ?? null, updated_at: now() };
  await db.notify_providers.upsert({
    where: { api_key: apiKey },
    update: data,
    create: { api_key: apiKey, ...data },
  });
}

export async function deleteProviderRow(db, apiKey) {
  await db.notify_providers.deleteMany({ where: { api_key: apiKey } });
}

/** Append one notification attempt. Failures here must not break a send, so callers catch. */
export async function appendLog(db, apiKey, entry) {
  await db.notify_log.create({
    data: {
      id: randomUUID(), api_key: apiKey, at: now(), channel: entry.channel,
      contact_slug: entry.contactSlug, trigger: entry.trigger, status: entry.status,
      provider_id: entry.providerId ?? null, error: entry.error ?? null,
    },
  });
}

/** Newest first. The UI shows the log, never the provider secrets. */
export async function listLog(db, apiKey, limit = 100) {
  const rows = await db.notify_log.findMany({ where: { api_key: apiKey }, orderBy: { at: 'desc' }, take: Math.min(limit, 500) });
  return rows.map((r) => ({
    at: r.at, channel: r.channel, contactSlug: r.contact_slug, trigger: r.trigger,
    status: r.status, providerId: r.provider_id ?? null, error: r.error ?? null,
  }));
}

/** Keep the log for `days` days (default 90). Returns the number of removed rows. */
export async function purgeLog(db, days = 90) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const res = await db.notify_log.deleteMany({ where: { at: { lt: cutoff } } });
  return res.count;
}
