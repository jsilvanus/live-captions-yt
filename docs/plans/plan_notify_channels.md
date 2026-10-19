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
- Table `notify_log`: time, project, channel, contact slug, masked recipient, result, provider message id. No message bodies with personal data. Kept 90 days.
- **Rate limits per contact and channel** (per hour and per day), checked before the provider call. A project-wide cap is a backstop only.
- Routes: `GET/POST /contacts`, `PATCH/DELETE /contacts/:id`, `POST /notify/send` (manual send), `GET /notify/log`, `GET/PUT /notify/rules`.

### 2. Contacts (Setup Hub card "Contacts")

- Fields: `slug` (unique per project, lowercase letters, digits and hyphens, used in metacodes), display name (optional), `email`, `smsNumber` (E.164, validated), `consentEmail` and `consentSms` (each with a date and source), `active`.
- Reserved slugs are refused. `admin` is reserved, and `all` is reserved too.
- UI: list, add, edit, disable. A contact without consent for a channel can't receive on that channel, and the UI says so.
- Storage: a `notify_contacts` table scoped to the project, not in the project definition.
- Only the Setup tier may add or edit contacts (see "Why Setup tier" below).

### 3. Metacode `notify[channel,slug]:text`

Examples from Juha, written as the HTML comment the parser reads:

```
<!-- notify[sms,churchwarden]: We are now in Eucharist. Ring the church bells. -->
<!-- notify[email,admin]: Stream is starting. -->
```

- **One recipient per metacode.** Each `notify[...]` names exactly one contact slug. Sending to several people means several metacodes.
- **Syntax:** no `!` prefix. In the parser, `!` is only used for the API-connector pointer tier (`!api:`). Timers, `goto` and `file` are pointer actions without `!`, and the registry sets that per name. `notify` follows the same pattern. If you want an explicit `!notify[...]`, that is a one-line change to the parser design.
- The registry (`packages/lcyt-web/src/lib/metacode-registry.js`) gets a `notify` entry with `kind: 'action'` and `fires: 'pointer'`. The bracket form already exists for `file[server]`. The comma inside the brackets is new and needs parser support.
- The client queues the send; the backend `NotifyService` does it; the operator sees the result (sent, skipped for no consent, rate-limited, or failed). Failures are never silent.
- **No confirmation step.** Protection comes from:
  - a **cooldown** per (channel, contact, message text), about 60 seconds, so a repeated line doesn't re-send, and
  - a **rate limit per contact** (per hour and per day), so one person can't be flooded.
- The text after the colon is the message. For SMS its length is capped at one segment (to be decided).

### 4. Notifications card (Assets page)

Rules configured per project, each with:
- **trigger:** `stream.running_for` (threshold X, repeat interval), `stream.started`, `stream.degraded`, `stream.ended`.
- **recipient:** one contact slug per rule, with the same consent and per-contact rate limits as metacodes.
- **message template** with variables such as `{{project}}` and `{{minutes}}`.
- **enabled** and a **cooldown**. Rules are off by default and must name a recipient.

Example rules: "stream on for over 4 hours, SMS admin"; "stream started, email admin".

**Unverified:** whether the platform and RTMP layers already emit start, degraded and end events. `lcyt-platforms` has `platform.*` events (its `stats-poller.js`), but I haven't read the stream-health path yet. That check is part of phase 5.

## Why Setup tier only for contacts

Contacts hold other people's email addresses and phone numbers. Editors and operators work on the rundown and the captions; they don't need to see or change who gets alerts. Setup is the tier that already controls connectors and other settings that reach outside the project (`plan_project_roles.md`). Keeping contacts there means one role decides who can be contacted, and an operator can't add a number and send to it.

## Safety and data protection

- **Consent:** no send without consent for that contact and channel. Skipped sends are logged.
- **Opt-out:** SMS opt-out (STOP) is handled by the provider and must be honoured. Email needs an unsubscribe link for non-transactional mail. Staff alerts may count as transactional; that needs a decision.
- **Personal data:** phone numbers and email addresses. The log is kept 90 days. Record the lawful basis and sign Brevo's DPA. Check Brevo's data location first.
- **Church context:** these contacts are staff and volunteers. Before collecting anything about members, run the `church-data-protection-advisor` checks.
- **Secrets:** the Brevo key is env-only (`NOTIFY_BREVO_API_KEY`) and never logged.

## Configuration (env-only secrets)

- `NOTIFY_BREVO_API_KEY`, `NOTIFY_BREVO_SENDER_EMAIL`, `NOTIFY_BREVO_SENDER_NAME`
- `NOTIFY_SMS_SENDER` (sender ID, subject to the rules to be verified)
- Rate, cooldown and retention settings can later move to the server settings registry.

## Phases

1. **This PR:** plan and research. Waiting for Juha's go.
2. **Core:** plugin skeleton, interfaces, `NotifyService`, log, rate limits, Brevo email and SMS. Tests against a fake HTTP server, plus one contract suite every adapter must pass.
3. **Contacts:** table, routes, Setup Hub card.
4. **Metacode:** registry entry, parser support for `[channel,slug]`, pointer wiring, operator feedback.
5. **Notifications card:** rules, stream triggers (after the check above), cooldowns.
6. **Later:** AI tool wiring in `lcyt-tools`, and phone calls (see the research).

## Decisions (Juha, 2026-10-19)

- `notify` fires when the pointer reaches the line.
- One recipient per metacode.
- No confirmation step. Cooldown per contact and text, and a rate limit per contact.
- `admin` is a reserved slug.
- The notify log is kept 90 days.

## Unverified

- Brevo SMS request fields, sender ID rules, and webhook payloads.
- Whether stream start, degraded and end events exist in the platform or RTMP layers.
- Whether Brevo stores data in the EU.
- SMS sender ID rules for Finland.
