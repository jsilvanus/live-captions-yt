// Generic SMTP email adapter. Email only: SMS is never offered over SMTP.
// Uses nodemailer for the wire protocol. Errors are reduced to a code and a
// fixed text, because SMTP server replies can echo credentials or addresses.

import nodemailer from 'nodemailer';

/**
 * @param {{ host: string, port?: number, secure?: boolean, user?: string, pass?: string,
 *           from: string, transportFactory?: (opts: object) => { sendMail: Function } }} config
 */
export function createSmtpEmailAdapter(config) {
  const {
    host, port = 587, secure = port === 465, user, pass, from,
    transportFactory = (opts) => nodemailer.createTransport(opts),
  } = config;
  if (!host) throw new Error('smtp: host is required');
  if (!from) throw new Error('smtp: from is required');
  if ((user && !pass) || (!user && pass)) throw new Error('smtp: user and pass must be set together');

  const transport = transportFactory({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  return {
    channel: 'email',
    provider: 'smtp',
    /**
     * @param {{ to: string, subject: string, text: string }} msg
     * @returns {Promise<{ id: string }>}
     */
    async send({ to, subject, text }) {
      try {
        const info = await transport.sendMail({ from, to, subject, text });
        return { id: String(info?.messageId ?? '') };
      } catch (err) {
        const code = typeof err?.responseCode === 'number' ? ` ${err.responseCode}`
          : err?.code ? ` ${String(err.code).replace(/[^A-Z_]/g, '')}` : '';
        throw new Error(`smtp: send failed${code}`);
      }
    },
  };
}
