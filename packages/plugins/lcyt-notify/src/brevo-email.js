// Brevo (formerly Sendinblue) transactional email adapter.
// Endpoint and body follow Brevo's transactional email API (POST /v3/smtp/email).
// The API key is sent only in the `api-key` header and never appears in errors.

const DEFAULT_BASE_URL = 'https://api.brevo.com';

/**
 * @param {{ apiKey: string, senderEmail: string, senderName?: string,
 *           baseUrl?: string, fetchImpl?: typeof fetch }} config
 */
export function createBrevoEmailAdapter(config) {
  const { apiKey, senderEmail, senderName, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = config;
  if (!apiKey) throw new Error('brevo: apiKey is required');
  if (!senderEmail) throw new Error('brevo: senderEmail is required');

  return {
    channel: 'email',
    provider: 'brevo',
    /**
     * @param {{ to: string, subject: string, text: string }} msg
     * @returns {Promise<{ id: string }>}
     */
    async send({ to, subject, text }) {
      const body = {
        sender: senderName ? { email: senderEmail, name: senderName } : { email: senderEmail },
        to: [{ email: to }],
        subject,
        textContent: text,
      };
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/v3/smtp/email`, {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch {
        // Network errors can carry the URL, never the key; keep the message generic.
        throw new Error('brevo: request failed (network)');
      }
      if (!res.ok) {
        throw new Error(`brevo: request failed with HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      return { id: String(data.messageId ?? '') };
    },
  };
}
