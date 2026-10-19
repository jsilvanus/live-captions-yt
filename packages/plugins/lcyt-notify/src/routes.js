// Contacts and Contact Providers API. Mounted by lcyt-backend behind the setup tier
// (requireProjectRole(db, 'setup')): contact phone numbers and provider secrets are
// not for ordinary members.
//
//   GET    /notify/contacts          list
//   PUT    /notify/contacts/:slug    create or replace { name?, email?, smsNumber?, consentEmail, consentSms, active }
//   DELETE /notify/contacts/:slug    remove
//   GET    /notify/provider          settings; secrets are never returned, only hasSecret
//   PUT    /notify/provider          save { provider, config, secrets? } (secrets encrypted at rest)
//   DELETE /notify/provider          remove
//   GET    /notify/log?limit=        recent attempts

import { Router } from 'express';
import { encryptSecret, decryptSecret, loadCredentialKey, CredentialKeyError } from 'lcyt-platforms';
import {
  listContacts, saveContact, deleteContact,
  getProviderRow, saveProviderRow, deleteProviderRow, listLog,
} from './db.js';
import { validateContact, validateProvider, buildNotifyAdapters, NotifyConfigError } from './config.js';

const requireSession = (req, res) => {
  const apiKey = req.session?.apiKey;
  if (!apiKey) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return apiKey;
};

/**
 * @param {object} db Prisma client
 * @param {import('express').RequestHandler} auth
 * @param {{ credentialKey?: () => Buffer }} [opts] credentialKey throws CredentialKeyError when unset
 */
export function createNotifyRouter(db, auth, opts = {}) {
  const credentialKey = opts.credentialKey ?? (() => loadCredentialKey());
  const router = Router();
  router.use(auth);

  const fail = (res, err) => {
    if (err instanceof NotifyConfigError) return res.status(400).json({ error: err.message });
    if (err instanceof CredentialKeyError) return res.status(503).json({ error: err.message });
    throw err;
  };

  router.get('/notify/contacts', async (req, res) => {
    const apiKey = requireSession(req, res);
    if (!apiKey) return;
    res.json({ contacts: await listContacts(db, apiKey) });
  });

  router.put('/notify/contacts/:slug', async (req, res) => {
    const apiKey = requireSession(req, res);
    if (!apiKey) return;
    let contact;
    try {
      contact = validateContact({ ...req.body, slug: req.params.slug });
    } catch (err) {
      return fail(res, err);
    }
    const { contact: saved, created } = await saveContact(db, apiKey, contact);
    res.status(created ? 201 : 200).json({ contact: saved });
  });

  router.delete('/notify/contacts/:slug', async (req, res) => {
    const apiKey = requireSession(req, res);
    if (!apiKey) return;
    const slug = String(req.params.slug).toLowerCase();
    if (!(await deleteContact(db, apiKey, slug))) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });

  router.get('/notify/provider', async (req, res) => {
    const apiKey = requireSession(req, res);
    if (!apiKey) return;
    const row = await getProviderRow(db, apiKey);
    if (!row) return res.json({ configured: false });
    res.json({
      configured: true,
      provider: row.provider,
      config: JSON.parse(row.config_json),
      hasSecret: !!row.secrets_enc,
      updatedAt: row.updated_at,
    });
  });

  router.put('/notify/provider', async (req, res) => {
    const apiKey = requireSession(req, res);
    if (!apiKey) return;
    try {
      const v = validateProvider(req.body);
      const key = credentialKey();
      // Secrets are written only when sent; an empty secrets object keeps the stored ones.
      const previous = await getProviderRow(db, apiKey);
      let secretsEnc = previous?.secrets_enc ?? null;
      if (Object.keys(v.secrets).length > 0 || previous?.provider !== v.provider) {
        if (Object.keys(v.secrets).length === 0) {
          return res.status(400).json({ error: 'secrets are required when the provider changes' });
        }
        secretsEnc = encryptSecret(JSON.stringify(v.secrets), key);
      }
      await saveProviderRow(db, apiKey, {
        provider: v.provider, configJson: JSON.stringify(v.config), secretsEnc,
      });
      res.json({ configured: true, provider: v.provider, config: v.config, hasSecret: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/notify/provider', async (req, res) => {
    const apiKey = requireSession(req, res);
    if (!apiKey) return;
    await deleteProviderRow(db, apiKey);
    res.status(204).end();
  });

  router.get('/notify/log', async (req, res) => {
    const apiKey = requireSession(req, res);
    if (!apiKey) return;
    const limit = Number(req.query.limit ?? 100);
    res.json({ log: await listLog(db, apiKey, Number.isFinite(limit) ? limit : 100) });
  });

  return router;
}

/**
 * Load the provider of a project and build its adapters (the notify service uses these).
 * Returns null when no provider is configured. Decrypts the secrets in memory only.
 */
export async function loadNotifyAdapters(db, apiKey, credentialKey = () => loadCredentialKey(), deps = {}) {
  const row = await getProviderRow(db, apiKey);
  if (!row) return null;
  const secrets = row.secrets_enc ? JSON.parse(decryptSecret(row.secrets_enc, credentialKey())) : {};
  return buildNotifyAdapters(row.provider, JSON.parse(row.config_json), secrets, deps);
}

