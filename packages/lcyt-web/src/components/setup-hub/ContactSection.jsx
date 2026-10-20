import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { Dialog } from '../Dialog.jsx';
import { useSetupT } from '../../lib/useSetupT.js';
import { setupToken } from '../../lib/setupToken.js';
import {
  EMPTY_CONTACT_FORM, contactToForm, contactBody, validateContactForm, consentIssues,
  providerToForm, providerBody, validateProviderForm, providerChannels,
} from '../../lib/notifyContacts.js';

// The router declares /notify/... itself; lcyt-backend mounts it so the public path is /api/v1/notify/...
const API = '/api/v1/notify';
const LOG_LIMIT = 8;

const inputStyle = { padding: '0.4rem 0.5rem', borderRadius: 6, border: '1px solid var(--border, #ccc)', width: '100%', boxSizing: 'border-box' };
const labelStyle = { fontSize: '0.8em', fontWeight: 600, opacity: 0.8, display: 'block', marginBottom: 2 };
const fieldStyle = { marginBottom: '0.6rem' };
const hintStyle = { fontSize: 12, opacity: 0.8, margin: '2px 0 0' };
const warnStyle = { fontSize: 12, color: 'var(--color-warning, #b45309)', margin: '2px 0 0' };

function ContactIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 4.5L8 9L14 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * ContactSection — Setup Hub card "Contact": the provider that sends email/SMS (Brevo or SMTP;
 * secrets write-only) and the contacts that may receive them (consent per channel), plus the recent log.
 * Backed by `/api/v1/notify` (lcyt-notify, setup tier only).
 */
export function ContactSection() {
  const t = useSetupT();
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const getSessionToken = session?.getSessionToken;

  const [contacts, setContacts] = useState([]);
  const [provider, setProvider] = useState(null); // GET /notify/provider answer
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // { slug?: string, form }
  const [editingProvider, setEditingProvider] = useState(null); // { form }
  const [formError, setFormError] = useState('');

  const api = useCallback(async (path, { method = 'GET', body } = {}) => {
    const token = setupToken(session);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${backendUrl}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
    return data;
  }, [backendUrl, getSessionToken, session?.projectAccessToken]);

  const load = useCallback(async () => {
    if (!connected || !backendUrl) return;
    try {
      const [c, p, l] = await Promise.all([
        api(`${API}/contacts`), api(`${API}/provider`), api(`${API}/log?limit=${LOG_LIMIT}`),
      ]);
      setContacts(c.contacts || []);
      setProvider(p);
      setLog(l.log || []);
      setError('');
    } catch (e) { setError(e.status === 403 ? t('contact.err.setupOnly') : e.message); }
  }, [connected, backendUrl, api, t]);

  useEffect(() => { load(); }, [load]);

  const setField = (name, value) => setEditing((e) => ({ ...e, form: { ...e.form, [name]: value } }));
  const setPField = (name, value) => setEditingProvider((e) => ({ ...e, form: { ...e.form, [name]: value } }));

  async function saveContact() {
    const key = validateContactForm(editing.form, { isNew: !editing.slug });
    if (key) { setFormError(t(`contact.err.${key}`)); return; }
    const slug = editing.slug || editing.form.slug.trim().toLowerCase();
    try {
      await api(`${API}/contacts/${encodeURIComponent(slug)}`, { method: 'PUT', body: contactBody(editing.form) });
      setEditing(null);
      load();
    } catch (e) { setFormError(e.message); }
  }

  async function removeContact(c) {
    if (!window.confirm(t('contact.confirmDelete', { name: c.name || c.slug }))) return;
    try { await api(`${API}/contacts/${encodeURIComponent(c.slug)}`, { method: 'DELETE' }); load(); } catch (e) { setError(e.message); }
  }

  async function saveProvider() {
    const key = validateProviderForm(editingProvider.form, provider);
    if (key) { setFormError(t(`contact.err.${key}`)); return; }
    try {
      await api(`${API}/provider`, { method: 'PUT', body: providerBody(editingProvider.form) });
      setEditingProvider(null);
      load();
    } catch (e) { setFormError(e.status === 503 ? t('contact.err.noKey') : e.message); }
  }

  async function removeProvider() {
    if (!window.confirm(t('contact.provider.confirmDelete'))) return;
    try { await api(`${API}/provider`, { method: 'DELETE' }); load(); } catch (e) { setError(e.message); }
  }

  const openAdd = () => { setFormError(''); setEditing({ form: { ...EMPTY_CONTACT_FORM } }); };
  const openEdit = (c) => { setFormError(''); setEditing({ slug: c.slug, form: contactToForm(c) }); };
  const openProvider = () => { setFormError(''); setEditingProvider({ form: providerToForm(provider) }); };

  const f = editing?.form;
  const pf = editingProvider?.form;
  const channels = providerChannels(provider);
  const hasProvider = !!provider?.configured;

  function contactMeta(c) {
    const { noConsent, noAddress } = consentIssues(c);
    const parts = [c.email, c.smsNumber].filter(Boolean);
    if (!parts.length) parts.push(t('contact.noAddress'));
    if (c.active === false) parts.push(t('contact.inactive'));
    for (const ch of noConsent) parts.push(`⚠ ${t(`contact.noConsent.${ch}`)}`);
    for (const ch of noAddress) parts.push(`⚠ ${t(`contact.noAddressFor.${ch}`)}`);
    return parts.join(' · ');
  }

  const providerMeta = hasProvider
    ? [
        t(`contact.provider.name.${provider.provider}`),
        channels.map((ch) => t(`contact.channel.${ch}`)).join(' + '),
        provider.hasSecret ? t('contact.secret.set') : t('contact.secret.unset'),
      ].join(' · ')
    : t('contact.provider.none');

  return (
    <SetupCard
      id="contact"
      icon={ContactIcon}
      color="teal"
      title={t('hub.card.contact')}
      description={t('contact.desc')}
      status="ready"
      headerAction={connected ? { label: t('contact.add'), onClick: openAdd } : undefined}
      emptyText={!connected ? t('contact.connect') : undefined}
    >
      {connected ? (<>
        {error && <p className="setup-card__empty" style={{ color: 'var(--color-error)' }}>{error}</p>}

        <SetupItemRow
          name={t('contact.provider.title')}
          statusDot={hasProvider ? '#16a34a' : '#9ca3af'}
          meta={providerMeta}
          onSettings={openProvider}
          onDelete={hasProvider ? removeProvider : undefined}
        />

        {contacts.length === 0 && <p className="setup-card__empty">{t('contact.empty')}</p>}
        {contacts.map((c) => (
          <SetupItemRow
            key={c.slug}
            name={c.name ? `${c.name} (${c.slug})` : c.slug}
            meta={contactMeta(c)}
            faded={c.active === false}
            onSettings={() => openEdit(c)}
            onDelete={() => removeContact(c)}
          />
        ))}

        {log.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <span style={labelStyle}>{t('contact.log.title')}</span>
            {log.map((l, i) => (
              <p key={`${l.at}-${i}`} style={{ ...hintStyle, color: l.status === 'sent' ? undefined : 'var(--color-error)' }}>
                {l.at} · {l.channel} · {l.contactSlug} · {l.status}{l.error ? ` (${l.error})` : ''}
              </p>
            ))}
          </div>
        )}

        {editing && (
          <Dialog
            title={editing.slug ? t('contact.editTitle') : t('contact.addTitle')}
            onClose={() => setEditing(null)}
            footer={(
              <>
                {formError && <span style={{ fontSize: 12, color: 'var(--color-error)', marginRight: 'auto' }}>{formError}</span>}
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(null)}>{t('contact.cancel')}</button>
                <button type="button" className="btn btn--primary btn--sm" onClick={saveContact}>{t('contact.save')}</button>
              </>
            )}
          >
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="contact-slug">{t('contact.field.slug')}</label>
              <input id="contact-slug" style={inputStyle} value={f.slug} disabled={Boolean(editing.slug)} onChange={(e) => setField('slug', e.target.value)} />
              <p style={hintStyle}>{t('contact.field.slugHint')}</p>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="contact-name">{t('contact.field.name')}</label>
              <input id="contact-name" style={inputStyle} value={f.name} onChange={(e) => setField('name', e.target.value)} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="contact-email">{t('contact.field.email')}</label>
              <input id="contact-email" type="email" style={inputStyle} value={f.email} onChange={(e) => setField('email', e.target.value)} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <input type="checkbox" checked={f.consentEmail} onChange={(e) => setField('consentEmail', e.target.checked)} />
                {t('contact.field.consentEmail')}
              </label>
              {f.email.trim() && !f.consentEmail && <p style={warnStyle}>{t('contact.noConsent.email')}</p>}
              {hasProvider && !channels.includes('email') && <p style={warnStyle}>{t('contact.noProviderFor.email')}</p>}
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="contact-sms">{t('contact.field.sms')}</label>
              <input id="contact-sms" type="tel" style={inputStyle} placeholder="+358 40 123 4567" value={f.smsNumber} onChange={(e) => setField('smsNumber', e.target.value)} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <input type="checkbox" checked={f.consentSms} onChange={(e) => setField('consentSms', e.target.checked)} />
                {t('contact.field.consentSms')}
              </label>
              {f.smsNumber.trim() && !f.consentSms && <p style={warnStyle}>{t('contact.noConsent.sms')}</p>}
              {hasProvider && !channels.includes('sms') && <p style={warnStyle}>{t('contact.noProviderFor.sms')}</p>}
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <input type="checkbox" checked={f.active} onChange={(e) => setField('active', e.target.checked)} />
              {t('contact.field.active')}
            </label>
            <p style={hintStyle}>{t('contact.consentNote')}</p>
          </Dialog>
        )}

        {editingProvider && (
          <Dialog
            title={t('contact.provider.title')}
            onClose={() => setEditingProvider(null)}
            footer={(
              <>
                {formError && <span style={{ fontSize: 12, color: 'var(--color-error)', marginRight: 'auto' }}>{formError}</span>}
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditingProvider(null)}>{t('contact.cancel')}</button>
                <button type="button" className="btn btn--primary btn--sm" onClick={saveProvider}>{t('contact.save')}</button>
              </>
            )}
          >
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="contact-provider">{t('contact.provider.field.provider')}</label>
              <select id="contact-provider" style={inputStyle} value={pf.provider} onChange={(e) => setPField('provider', e.target.value)}>
                <option value="brevo">{t('contact.provider.name.brevo')}</option>
                <option value="smtp">{t('contact.provider.name.smtp')}</option>
              </select>
              <p style={hintStyle}>{pf.provider === 'brevo' ? t('contact.provider.hintBrevo') : t('contact.provider.hintSmtp')}</p>
            </div>

            {pf.provider === 'brevo' ? (
              <>
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="contact-apikey">{t('contact.provider.field.apiKey')}</label>
                  <input id="contact-apikey" type="password" autoComplete="off" style={inputStyle} value={pf.apiKey} onChange={(e) => setPField('apiKey', e.target.value)} />
                  <p style={hintStyle}>{provider?.configured && provider.provider === 'brevo' && provider.hasSecret ? t('contact.secret.keep') : t('contact.secret.unset')}</p>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="contact-senderemail">{t('contact.provider.field.senderEmail')}</label>
                  <input id="contact-senderemail" type="email" style={inputStyle} value={pf.senderEmail} onChange={(e) => setPField('senderEmail', e.target.value)} />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="contact-sendername">{t('contact.provider.field.senderName')}</label>
                  <input id="contact-sendername" style={inputStyle} value={pf.senderName} onChange={(e) => setPField('senderName', e.target.value)} />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="contact-smssender">{t('contact.provider.field.smsSender')}</label>
                  <input id="contact-smssender" style={inputStyle} maxLength={15} value={pf.smsSender} onChange={(e) => setPField('smsSender', e.target.value)} />
                  <p style={hintStyle}>{t('contact.provider.smsSenderHint')}</p>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ ...fieldStyle, flex: 3 }}>
                    <label style={labelStyle} htmlFor="contact-host">{t('contact.provider.field.host')}</label>
                    <input id="contact-host" style={inputStyle} value={pf.host} onChange={(e) => setPField('host', e.target.value)} />
                  </div>
                  <div style={{ ...fieldStyle, flex: 1 }}>
                    <label style={labelStyle} htmlFor="contact-port">{t('contact.provider.field.port')}</label>
                    <input id="contact-port" type="number" min="1" max="65535" style={inputStyle} value={pf.port} onChange={(e) => setPField('port', e.target.value)} />
                  </div>
                </div>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <input type="checkbox" checked={pf.secure} onChange={(e) => setPField('secure', e.target.checked)} />
                  {t('contact.provider.field.secure')}
                </label>
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="contact-from">{t('contact.provider.field.from')}</label>
                  <input id="contact-from" style={inputStyle} value={pf.from} onChange={(e) => setPField('from', e.target.value)} />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="contact-user">{t('contact.provider.field.user')}</label>
                  <input id="contact-user" autoComplete="off" style={inputStyle} value={pf.user} onChange={(e) => setPField('user', e.target.value)} />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="contact-pass">{t('contact.provider.field.pass')}</label>
                  <input id="contact-pass" type="password" autoComplete="new-password" style={inputStyle} value={pf.pass} onChange={(e) => setPField('pass', e.target.value)} />
                  <p style={hintStyle}>{t('contact.provider.passHint')}</p>
                </div>
              </>
            )}
            <p style={hintStyle}>{t('contact.provider.noTest')}</p>
          </Dialog>
        )}
      </>) : null}
    </SetupCard>
  );
}
