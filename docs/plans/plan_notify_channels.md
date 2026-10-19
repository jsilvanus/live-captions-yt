# Plan: notifications, email and SMS (`lcyt-notify`)

Status: **draft**, waiting for Juha's go. No code yet.
Research: [`notify-research-2026-10-18.md`](notify-research-2026-10-18.md) (kept complete, including the phone research, which is for later).

## Scope now

- **Email and SMS only**, through a Brevo adapter.
- **Contacts**: a Setup Hub card where people are saved with a slug, an email and an SMS number.
- **Metacode `notify[channel,slug]:text`** in the rundown, so an operator can send a message when the pointer reaches a line.
- **Notifications card** on the Assets page: rules for stream alerts, such as "stream on for more than X" and stream health (start, degraded, end).
- An attempt log, rate limits and consent checks.

Out of scope: phone calls, AI calls, live audio, and bell or hardware actions.

## Future: phone calls

Phone calls (TTS, premade audio, AI calls, live audio) are **not** part of this plan. The research on Siptel, Telnyx and others is kept in the research document for later. The channel design leaves room for a `call` channel, so it can be added later without changing the contact model.

## Components

### 1. `lcyt-notify` plugin (backend)

- Channel interface: `email.send({to, subject, text})`, `sms.send({to, text})`. Each adapter declares its capabilities.
- `NotifyService` picks the adapter per channel from config. Only it calls adapters.
- **Brevo adapter:** email through the transactional API (`api-key` header). SMS through `POST /v3/transactionalSMS/send`. The SMS fields are **unverified**; check the official reference before coding.
- Table `notify_log`: time, project, channel, contact slug, masked recipient, result, provider message id. No message bodies with personal data.
- Rate limits per project (per minute and per day), checked before the provider call.
- Routes: `GET/POST /contacts`, `PATCH/DELETE /contacts/:id`, `POST /notify/send` (manual send), `GET /notify/log`, `GET/PUT /notify/rules`.

### 2. Contacts (Setup Hub card "Contacts")

- Fields: `slug` (unique per project, lowercase letters, digits and hyphens, used in metacodes), display name (optional), `email`, `smsNumber` (E.164, validated), `consentEmail` and `consentSms` (each with a date and source), `active`.
- Reserved slugs are refused (`all`, `admin` if we want it reserved; to decide).
- UI: list, add, edit, disable. A contact without consent for a channel can't receive on that channel, and the UI says so.
- Storage: a `notify_contacts` table scoped to the project, not in the project definition.
- Only the Setup tier may add or edit contacts (`plan_project_roles.md`).

### 3. Metacode `notify[channel,slug]:text`

Examples from Juha:

```
notify[sms,churchwarden]: We are now in Eucharist. Ring the church bells.
notify[email,admin]: Stream is starting.
```

- The registry (`packages/lcyt-web/src/lib/metacode-registry.js`) gets a `notify` entry with `kind: 'action'`. The bracket form already exists for `file[server]`, so the name pattern is supported. The comma inside the brackets is new and needs parser support.
- **When it fires (proposed):** `pointer`, like `timer` and `goto`, so it runs when the operator reaches that line. The alternative is `send`, like named actions.
- The client queues the send; the backend `NotifyService` does it; the operator sees the result (sent, skipped for no consent, rate-limited, or failed). Failures are never silent.
- **Guard:** a cooldown per (channel, contact, text) of about 60 seconds, and the loop guard already used by backend actions.
- Text after the colon is the message. Its length is capped (for SMS, one segment, to be decided).

### 4. Notifications card (Assets page)

Rules configured per project, each with:
- **trigger:** `stream.running_for` (threshold X, repeat interval), `stream.started`, `stream.degraded`, `stream.ended`.
- **channels and recipients:** contacts by slug, or all contacts with consent for that channel.
- **message template** with variables such as `{{project}}` and `{{minutes}}`.
- **enabled** and a **cooldown**. Rules are off by default and must name recipients.

Example rules: "stream on for over 4 hours, SMS admin"; "stream started, email admin".

**Unverified:** whether the platform and RTMP layers already emit start, degraded and end events. `lcyt-platforms` has `platform.*` events (its `stats-poller.js`), but I haven't read the stream-health path yet. That check is part of phase 5.

## Safety and data protection

- **Consent:** no send without consent for that contact and channel. Skipped sends are logged.
- **Opt-out:** SMS opt-out (STOP) is handled by the provider and must be honoured. Email needs an unsubscribe link for non-transactional mail. Staff alerts may count as transactional; that needs a decision.
- **Personal data:** phone numbers and email addresses. Record the lawful basis, set a retention period for the log (proposed: 90 days), and sign Brevo's DPA. Check Brevo's data location first.
- **Church context:** these contacts are staff and volunteers. Before collecting anything about members, run the `church-data-protection-advisor` checks.
- **Secrets:** the Brevo key is env-only (`NOTIFY_BREVO_API_KEY`) and never logged.

## Configuration (env-only secrets)

- `NOTIFY_BREVO_API_KEY`, `NOTIFY_BREVO_SENDER_EMAIL`, `NOTIFY_BREVO_SENDER_NAME`
- `NOTIFY_SMS_SENDER` (sender ID, subject to the rules to be verified)
- Rate and retention settings can later move to the server settings registry.

## Phases

1. **This PR:** plan and research. Waiting for Juha's go.
2. **Core:** plugin skeleton, interfaces, `NotifyService`, log, rate limits, Brevo email and SMS. Tests against a fake HTTP server, plus one contract suite every adapter must pass.
3. **Contacts:** table, routes, Setup Hub card.
4. **Metacode:** registry entry, parser support for `[channel,slug]`, pointer wiring, operator feedback.
5. **Notifications card:** rules, stream triggers (after the check above), cooldowns.
6. **Later:** AI tool wiring in `lcyt-tools`, and phone calls (see the research).

## Open questions for Juha

1. Should `notify[...]` fire when the pointer reaches the line (my proposal) or when the line is sent?
2. Allow several recipients in one metacode, such as `notify[sms,churchwarden+sexton]`?
3. Ask for confirmation before a metacode send, or rely on the cooldown and rate limits only?
4. Is `admin` a reserved slug?
5. How long should the notify log be kept (proposed: 90 days)?
6. Who may add contacts? Proposed: Setup tier only.
7. Accounts: Brevo account, sender domain (SPF, DKIM, DMARC), and the SMS sender ID rules for Finland (to verify).

## Unverified

- Brevo SMS request fields, sender ID rules, and webhook payloads.
- Whether stream start, degraded and end events exist in the platform or RTMP layers.
- Whether Brevo stores data in the EU.
