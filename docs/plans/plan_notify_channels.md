# Plan: notifications, email and SMS (`lcyt-notify`)

Status: **draft**, ready to implement once Juha gives the go. No code yet.
Research: [`notify-research-2026-10-18.md`](notify-research-2026-10-18.md) (kept complete, including the phone research, which is for later).

## Scope now

- **Email and SMS**, with a **Contact Providers** card to choose and configure the sending services.
- **Contact Providers:** Brevo first (email and SMS), then plain SMTP (email only).
- **Contacts:** a separate Setup Hub card where people are saved with a slug, an email and an SMS number.
- **Metacode `notify`** in the rundown, so an operator can send a message on pointer arrival (`!notify`) or on send (`notify`).
- An attempt log, rate limits and consent checks.

Deferred: **stream events and the notifications card** (start, degraded, end, "running for X"). They come after the basic system works.
Out of scope: phone calls, AI calls, live audio, and bell or hardware actions.

## Future: phone calls

Phone calls (TTS, premade audio, AI calls, live audio) are **not** part of this plan. The research on Siptel, Telnyx and others is kept in the research document for later. The channel design leaves room for a `call` channel, so it can be added later without changing the contact model.

## Components



- Channel interface: `email.send({to, subject, text})`, `sms.send({to, text})`. Each adapter declares its capabilities.
- Capabilities:
  - `brevo`: email and SMS.
  - `smtp`: email only. SMS is not offered when it is the email provider.
- `NotifyService` picks the adapter per channel from the Contact Providers config. Only it calls adapters.
- **Brevo adapter:** email through the transactional API (`api-key` header). SMS through `POST /v3/transactionalSMS/send`. The SMS fields are **unverified**; check the official reference before coding.
- **SMTP adapter:** host, port, TLS mode, username and password. Email only. Uses nodemailer 9.1.1 (the 10.x line needs Node 20; the backend declares Node 18).
- Table `notify_log`: time, project, channel, contact slug, masked recipient, result, provider message id. No message bodies with personal data. Kept 90 days.
- **Rate limits per contact and channel** (per hour and per day), checked before the provider call. A project-wide cap is a backstop only.
- Routes: `GET/PUT /notify/providers`, `POST /notify/providers/test`, `GET/POST /contacts`, `PATCH/DELETE /contacts/:id`, `POST /notify/send` (manual send), `GET /notify/log`.

### 2. Contact Providers (Setup Hub card "Contact Providers")

- Pick an email provider (Brevo or SMTP) and an SMS provider (Brevo, or none).
- Brevo: API key, sender email, sender name, SMS sender ID.
- SMTP: host, port, TLS mode, username, password, sender address.
- **Secrets are encrypted at rest in the database** (agreed by Juha, 2026-10-19). The method is the same as `lcyt-platforms` uses for OAuth tokens: AES-256-GCM, key from `PLATFORM_CREDENTIAL_KEY`. The key itself stays env-only. Saving credentials is refused when the key is not set.
- An env variable for each secret also works and wins over the stored value, as in the server settings registry.
- Secrets are write-only: the UI shows "set" or "not set", never the value.
- **Test button:** sends a test email or SMS to the logged-in admin's own address or to a chosen contact with consent.
- Only the Setup tier may change these settings.

### 3. Contacts (separate Setup Hub card "Contacts")

- Fields: `slug` (unique per project, lowercase letters, digits and hyphens, used in metacodes), display name (optional), `email`, `smsNumber` (E.164, validated), `consentEmail` and `consentSms` (each with a date and source), `active`.
- Reserved slugs are refused. `admin` and `all` are reserved.
- UI: list, add, edit, disable. A contact without consent for a channel can't receive on that channel, and the UI says so.
- Storage: a `notify_contacts` table scoped to the project, not in the project definition.
- Only the Setup tier may add or edit contacts (see "Why Setup tier" below).

### 4. Metacode `notify[channel,slug]:text`

Syntax, as decided by Juha on 2026-10-19:

- **`!` prefix = fires on pointer arrival**, when the operator reaches the line. Example: `<!-- !notify[sms,churchwarden]: We are now in Eucharist. Ring the church bells. -->`
- **No prefix = fires on send**, when the line is sent. Example: `<!-- notify[email,admin]: Stream is starting. -->`
- **No postfix.**

The `!` prefix is the same convention as the API-connector pointer tier (`!api:`), so it reads the same way across the parser. Timers, `goto` and `file` are pointer actions without a `!` today; they stay as they are.

- **One recipient per metacode.** Each `notify[...]` names exactly one contact slug. Sending to several people means several metacodes.
- The registry entry is `kind: 'action'` with `fires: 'pointer'` for `!notify` and `fires: 'send'` for `notify`. The bracket form already exists for `file[server]`. The comma inside the brackets is new and needs parser support.
- The client queues the send; the backend `NotifyService` does it; the operator sees the result (sent, skipped for no consent, rate-limited, or failed). Failures are never silent.
- **No confirmation step.** Protection comes from:
  - a **cooldown** per (channel, contact, message text), about 60 seconds, so a repeated line doesn't re-send, and
  - a **rate limit per contact** (per hour and per day), so one person can't be flooded.
- The text after the colon is the message. For SMS its length is capped at one segment (to be decided).

## Why Setup tier only for contacts and contact providers

Contacts hold other people's email addresses and phone numbers, and contact providers hold the keys that send mail and SMS in the church's name. Editors and operators work on the rundown and the captions; they don't need to see or change either. Setup is the tier that already controls connectors and other settings that reach outside the project (`plan_project_roles.md`).

## Safety and data protection

- **Consent:** no send without consent for that contact and channel. Skipped sends are logged.
- **Opt-out:** SMS opt-out (STOP) is handled by the provider and must be honoured. Email needs an unsubscribe link for non-transactional mail. Staff alerts may count as transactional; that needs a decision.
- **Personal data:** phone numbers and email addresses. The log is kept 90 days. Record the lawful basis and sign Brevo's DPA. Check Brevo's data location first.
- **Church context:** these contacts are staff and volunteers. Before collecting anything about members, run the `church-data-protection-advisor` checks.
- **Secrets:** provider credentials are encrypted at rest, write-only in the UI, and never logged.

## Configuration

- `PLATFORM_CREDENTIAL_KEY`: already used by `lcyt-platforms`; reused to encrypt contact-provider credentials. Rotation is not built (same as today). Changing the key makes stored credentials unreadable.
- Optional env overrides: `NOTIFY_BREVO_API_KEY`, `NOTIFY_SMTP_PASSWORD`, and others, which win over the stored values.
- Rate, cooldown and retention settings can later move to the server settings registry.

## Phases

1. **This PR:** plan and research. Ready to implement on Juha's go.
2. **Core:** plugin skeleton, interfaces, `NotifyService`, log, rate limits, Brevo email and SMS. Tests against a fake HTTP server, plus one contract suite every adapter must pass.
3. **Contact Providers card:** encrypted credential storage, Brevo settings, test button. Then the SMTP adapter with the same contract tests.
4. **Contacts card:** table, routes, Setup Hub card.
5. **Metacode:** registry entries for `notify` and `!notify`, parser support for `[channel,slug]`, pointer and send wiring, operator feedback.
6. **Later:** stream events and the notifications card, AI tool wiring in `lcyt-tools`, and phone calls (see the research).

## Deferred: stream events

When the basic system works, check whether the platform and RTMP layers emit start, degraded and end events. `lcyt-platforms` has `platform.*` events (its `stats-poller.js`), but the stream-health path hasn't been read. Then design the notifications card: "running for X", start, degraded, end.

## Decisions (Juha, 2026-10-19)

- `!notify` fires on pointer arrival; `notify` fires on send. No postfix.
- One recipient per metacode.
- No confirmation step. Cooldown per contact and text, and a rate limit per contact.
- `admin` is a reserved slug.
- The notify log is kept 90 days.
- Contact Providers: Brevo first, then plain SMTP. Capabilities: Brevo email and SMS, SMTP email.
- Contact Providers and Contacts are separate Setup Hub cards.
- Provider credentials encrypted at rest.
- Stream events deferred.

## Open before implementation

- **Your go** to start building.
- **Brevo SMS request fields**, sender ID rules and webhook payloads. Check the official reference first.
- **Brevo data location** (EU?) and the Finnish SMS sender ID rules.

## Unverified

- Brevo SMS request fields, sender ID rules, and webhook payloads.
- Whether Brevo stores data in the EU.
- SMS sender ID rules for Finland.
- Whether stream start, degraded and end events exist (deferred).
