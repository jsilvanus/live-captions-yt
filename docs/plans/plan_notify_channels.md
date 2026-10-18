# Plan: notification channels (`lcyt-notify`)

Status: **draft**, waiting for Juha's go. No code yet.
Research: [`notify-research-2026-10-18.md`](notify-research-2026-10-18.md).

## Goal

Let LCYT send email, SMS and phone calls. Warnings such as "live is still on" are the first use. The same functions should later serve the Production Assistant and the Director.

## Requirements (from Juha, 2026-10-18)

1. **Call and play:** place a call and play a pre-recorded file, TTS, or a premade sound followed by TTS.
2. **Call and discuss with AI:** an AI takes part in the call with a role (Production Assistant, Director, and others).
3. **Call and listen:** stream live audio or feeds into the call.

Not every adapter must implement all three. For now, **only Siptel and only functions 1 and 2**. Function 3 is designed for, but not built.

## Scope

- **In:** plugin skeleton, channel interfaces, Brevo adapter (email and SMS), Siptel adapter (calls: create, play text, play audio, hangup, status, and agent calls), a `POST /notify/*` test route, an attempt log, env config, tests against fake HTTP servers.
- **Out (this plan):** streaming live audio, the Production Assistant tool wiring, UI beyond a minimal settings card, real-service verification.

## Design

### Channel interfaces

```
email.send({ to, subject, text, html? })            -> { id }
sms.send({ to, text })                               -> { id }
call.start({ to, from?, voice? })                    -> { callId }
call.speak(callId, { text, voice? })                 -> void      # TTS
call.playAudio(callId, { url })                      -> void      # premade WAV, 8 kHz
call.ask(callId, { prompt, agent? })                 -> void      # AI conversation (Siptel agent call)
call.hangup(callId)                                  -> void
call.status(callId)                                  -> { status, hangupCause? }
```

Each adapter declares its `capabilities` (for example `{ call: { speak: true, playAudio: true, ask: true, stream: false } }`). Callers check capabilities before calling, so a missing function is a clear error, not a silent failure.

### Adapters

| Adapter | Channels | Notes |
|---|---|---|
| `brevo` | email, sms | Email via transactional API. SMS endpoint `transactionalSMS/send` (unverified fields). |
| `siptel` | call, sms (optional) | `play-text`, `play-audio`, `hangup`, `call/{id}`, `agent/call`. |

A `NotifyService` picks an adapter per channel from config. It is the only place that calls adapters.

### Siptel mapping

- `call.start` → `POST /v1/voiceapi/call` (`to`, `from`, `max_duration`, `webhook_url`).
- `call.speak` → `POST /v1/voiceapi/play-text` (`call_id`, `text`, `voicename`).
- `call.playAudio` → `POST /v1/voiceapi/play-audio` (`call_id`, `audio_url`, WAV 8 kHz). The URL must be public for Siptel.
- `call.ask` → `POST /v1/agent/call` (`phone_number`, `caller_id`, `voice`, `task_prompt`, `greeting_message`, `record`, `voicemail_action`). Uses Siptel's LLM (`llm_provider`: groq or openai).
- `call.hangup` → `POST /v1/voiceapi/hangup`. **Agent calls have no documented hangup**; use `max_duration` and `enable_auto_end` until confirmed.
- `call.status` → `GET /v1/voiceapi/call/{call_id}`.

### Brevo mapping

- `email.send` → transactional email API (`api-key` header).
- `sms.send` → `POST /v3/transactionalSMS/send`. **Verify** body fields and sender ID rules before coding.

### Configuration

Secrets and anything that touches the network are env-only (`CLAUDE.md`, Configuration):

- `NOTIFY_BREVO_API_KEY`, `NOTIFY_BREVO_SENDER_EMAIL`, `NOTIFY_BREVO_SENDER_NAME`
- `NOTIFY_SIPTEL_API_KEY`, `NOTIFY_SIPTEL_FROM_NUMBER`, `NOTIFY_SIPTEL_VOICE`
- `NOTIFY_PUBLIC_AUDIO_BASE_URL` (where premade WAV files are reachable for Siptel)
- `NOTIFY_ALLOWED_RECIPIENTS` (optional allow-list, see Safety)

Non-secret tuning can go into the server settings registry later.

### Safety and guardrails

- **Opt-in recipients:** calls and SMS go only to numbers in a per-project contact list with consent recorded. No free dialling from the AI.
- **Human confirmation:** any call or SMS started by the AI needs a confirm step. A tool may only propose.
- **Rate and cost limits:** per-minute cap on calls and SMS, plus a daily cap, enforced before the provider call.
- **Attempt log:** every send and call is logged (channel, adapter, recipient hashed or masked, time, result, provider id). Never log message bodies with personal data.
- **Failure handling:** a failed call or SMS is retried only where the provider says it is safe; otherwise it fails and is logged.
- **Secrets:** keys never appear in logs or errors (scrub like the Facebook/Siptel bearer tokens elsewhere).

### Data protection

Phone numbers and email addresses are personal data. Before live use:
- record the lawful basis and an opt-out for each recipient,
- check where Brevo and Siptel process data (EU), and sign the DPAs,
- keep the attempt log short-lived and say how long.

## Phases

1. **This PR:** research and plan. Wait for Juha's go.
2. **Core:** plugin skeleton, interfaces, `NotifyService`, attempt log, config, tests with fakes. Email and SMS via Brevo.
3. **Calls:** Siptel adapter for `start`, `speak`, `playAudio`, `hangup`, `status`. Test route. Public audio hosting for premade files.
4. **AI calls:** `call.ask` via Siptel agent calls, with roles and prompts defined by LCYT. Human confirm step.
5. **Warnings:** wire "live still on" warnings to notify, with the consent and rate rules above.
6. **Later:** live-audio streaming (Telnyx media streaming or a Siptel SIP route), and the Production Assistant tools in `lcyt-tools`.

## Open questions for Juha

1. **Placement:** a plugin in live-captions-yt (my default) or a shared package for the other repos?
2. **Accounts:** Siptel account and number, Brevo account and sender domain (SPF, DKIM, DMARC). Do you have these?
3. **Siptel checks:** TTS engines for `play-text`, voices, call-end for agent calls, call and SMS pricing, live-media support on SIP trunks.
4. **AI calls:** should they use Siptel's LLM (groq or openai), or LCYT's own AI roles driving `play-text` and `gather-text` turns? The second gives us control over prompts and logs, but takes more work.
5. **Premade sounds:** keep them in LCYT's file storage and serve them at a public URL, or host them elsewhere?
6. **Recipients:** who may be called or texted, and who records consent?

## Unverified

- Brevo SMS request body, sender ID rules, webhook payloads, data location.
- Siptel TTS engines for `play-text`, agent-call hangup, call-status values, pricing, SIP trunk media.
- Everything about live streaming (phase 6).
