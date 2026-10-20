import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateContactForm, contactBody, consentIssues, providerBody, validateProviderForm,
  providerChannels, providerToForm, EMPTY_CONTACT_FORM, EMPTY_PROVIDER_FORM,
} from '../src/lib/notifyContacts.js';

const cf = o => ({ ...EMPTY_CONTACT_FORM, ...o });
const pf = o => ({ ...EMPTY_PROVIDER_FORM, ...o });

describe('validateContactForm', () => {
  it('checks slug rules and reserved slugs', () => {
    assert.equal(validateContactForm(cf({ slug: 'Warden' })), null);
    assert.equal(validateContactForm(cf({ slug: '-bad' })), 'slug');
    assert.equal(validateContactForm(cf({ slug: 'a b' })), 'slug');
    assert.equal(validateContactForm(cf({ slug: 'admin' })), 'reserved');
    assert.equal(validateContactForm(cf({ slug: 'all' })), 'reserved');
    assert.equal(validateContactForm(cf({ slug: '' }), { isNew: false }), null);
  });
  it('checks email and phone', () => {
    assert.equal(validateContactForm(cf({ slug: 'a', email: 'x' })), 'email');
    assert.equal(validateContactForm(cf({ slug: 'a', smsNumber: '123' })), 'phone');
    assert.equal(validateContactForm(cf({ slug: 'a', email: 'a@b.fi', smsNumber: '+358 40 123 4567' })), null);
  });
});

describe('contactBody and consentIssues', () => {
  it('trims and keeps booleans', () => {
    assert.deepEqual(contactBody(cf({ slug: 'a', name: ' N ', consentSms: true })),
      { name: 'N', email: '', smsNumber: '', consentEmail: false, consentSms: true, active: true });
  });
  it('flags missing consent and missing address', () => {
    assert.deepEqual(consentIssues({ email: 'a@b.fi', smsNumber: '+358401234567', consentEmail: true, consentSms: false }),
      { noConsent: ['sms'], noAddress: [] });
    assert.deepEqual(consentIssues({ email: null, smsNumber: null, consentEmail: true, consentSms: false }),
      { noConsent: [], noAddress: ['email'] });
  });
});

describe('provider helpers', () => {
  it('sends secrets only when typed', () => {
    assert.deepEqual(providerBody(pf({ senderEmail: 'a@b.fi' })).secrets, {});
    assert.deepEqual(providerBody(pf({ senderEmail: 'a@b.fi', apiKey: ' k ' })).secrets, { apiKey: 'k' });
    assert.deepEqual(providerBody(pf({ provider: 'smtp', host: 'h', from: 'f', pass: 'p' })).secrets, { pass: 'p' });
  });
  it('requires a secret when the provider is new or changes', () => {
    const f = pf({ senderEmail: 'a@b.fi' });
    assert.equal(validateProviderForm(f, { configured: false }), 'secret');
    assert.equal(validateProviderForm(f, { configured: true, provider: 'smtp' }), 'secret');
    assert.equal(validateProviderForm(f, { configured: true, provider: 'brevo' }), null);
    assert.equal(validateProviderForm(pf({ senderEmail: 'nope' }), { configured: true, provider: 'brevo' }), 'senderEmail');
  });
  it('validates smtp fields', () => {
    const base = { provider: 'smtp', host: 'h', from: 'f@x.fi', port: '587' };
    assert.equal(validateProviderForm(pf({ ...base, port: '0' }), null), 'port');
    assert.equal(validateProviderForm(pf({ ...base, user: 'u' }), null), 'userPass');
    assert.equal(validateProviderForm(pf({ ...base, user: 'u', pass: 'p' }), null), null);
    assert.equal(validateProviderForm(pf(base), null), null);
  });
  it('lists channels and fills the form', () => {
    assert.deepEqual(providerChannels({ configured: false }), []);
    assert.deepEqual(providerChannels({ configured: true, provider: 'smtp', config: {} }), ['email']);
    assert.deepEqual(providerChannels({ configured: true, provider: 'brevo', config: { smsSender: 'Church' } }), ['email', 'sms']);
    assert.equal(providerToForm({ configured: true, provider: 'smtp', config: { host: 'h', port: 465 } }).port, '465');
  });
});
