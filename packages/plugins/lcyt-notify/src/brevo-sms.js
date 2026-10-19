// Brevo transactional SMS adapter (POST /v3/transactionalSMS/send).
// Fields (sender max 11 alphanumeric or 15 numeric, recipient with country code,
// content, type) and the 201 response with messageId come from Brevo's
// transactional SMS endpoint docs. The API key is sent only in the `api-key` header.

const DEFAULT_BASE_URL = 'https://api.brevo.com';

/** Alphanumeric senders up to 11 characters, or numeric senders up to 15 digits. */
export function isValidSmsSender(sender) {
  if (typeof sender !== 'string' || sender.length === 0) return false;
  if (/^\d+$/.test(sender)) return sender.length <= 15;
  return sender.length <= 11 && /^[A-Za-z0-9]+$/.test(sender);
}

/** Digits only, with country code, no leading "+" (Brevo's examples). Null when implausible. */
export function normalizeRecipient(number) {
  if (typeof number !== 'string') return null;
  const digits = number.replace(/[\s()-]/g, '').replace(/^\+/, '').replace(/^00/, '');
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

/**
 * @param {{ apiKey: string, sender: string, baseUrl?: string, fetchImpl?: typeof fetch }} config
 */
export function createBrevoSmsAdapter(config) {
  const { apiKey, sender, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = config;
  if (!apiKey) throw new Error('brevo: apiKey is required');
  if (!isValidSmsSender(sender)) {
    throw new Error('brevo: sender must be 1-11 alphanumeric characters or 1-15 digits');
  }

  return {
    channel: 'sms',
    provider: 'brevo',
    /**
     * @param {{ to: string, text: string }} msg
     * @returns {Promise<{ id: string }>}
     */
    async send({ to, text }) {
      const recipient = normalizeRecipient(to);
      if (!recipient) throw new Error('brevo: invalid recipient number');
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/v3/transactionalSMS/send`, {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ sender, recipient, content: text, type: 'transactional' }),
        });
      } catch {
        throw new Error('brevo: SMS request failed (network)');
      }
      if (!res.ok) {
        throw new Error(`brevo: SMS request failed with HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      return { id: String(data.messageId ?? '') };
    },
  };
}
