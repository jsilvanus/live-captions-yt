# Notification channels: research (2026-10-18)

Research for the `lcyt-notify` plan (`docs/plans/plan_notify_channels.md`). It covers email, SMS and phone calls: what each provider offers, what we need, and what is still unknown. Sources are vendor docs and search results from 2026-10-18. Claims marked **unverified** have not been confirmed against the vendor.

## What we want from the phone channel

1. **Call and play:** place a call and play a pre-recorded file, TTS speech, or a premade sound followed by TTS.
2. **Call and talk to AI:** an AI discusses with the caller, with different roles (Production Assistant, Director).
3. **Call and listen:** stream the live audio or feeds into the call. Not needed for the first version.

Adapters do not all have to implement every function.

## Siptel (first adapter, calls)

Source: [docs.siptel.ai](https://docs.siptel.ai/) (the older `siptel.ai/docs` redirects there).

- **Base URL and auth:** `https://api.siptel.ai`, `v1`, JSON. `Authorization: Bearer <key>` from the dashboard.
- **Rate limit:** 60 requests per minute per key. Over that returns 429; the docs recommend exponential backoff.
- **Create call:** `POST /v1/voiceapi/call`. Required `to` (E.164) and `from` (a number you own). Optional `record`, `vm_detect`, `webhook_url`, `max_duration` (60–3600 s). Returns `call_id`.
- **Play text (TTS):** `POST /v1/voiceapi/play-text`. Required `call_id`, `text`, `voicename`. `voicename` comes from the dashboard's Voices tab.
- **Play audio:** `POST /v1/voiceapi/play-audio`. Required `call_id`, `audio_url`. The file must be WAV, 8 kHz, fetched over HTTP(S). So premade sounds must be hosted at a public URL that Siptel can reach.
- **Gather:** `gather-text` and `gather-audio` collect DTMF; results go to `webhook_url`.
- **Control:** `hold`, `unhold`, `transfer` (blind), `hangup`. `POST /v1/voiceapi/hangup` "immediately terminates an active call". This is the only explicit hangup endpoint.
- **Status:** `GET /v1/voiceapi/call/{call_id}` returns `call_status`, timestamps, `hangup_cause`, `cost`. `GET /v1/voiceapi/calls` lists calls with `limit` and `status` filters.
- **Webhooks:** only `dtmf_gathered` is shown for Voice API. SIP webhooks have `call_initiated`, `call_ringing`, `call_answered`, `call_hangup`. **Unverified:** a full event list, payload shapes, signing, retries.
- **AI agent call:** `POST /v1/agent/call`. Required: `phone_number`, `caller_id`, `voice`, `record`, `voicemail_action` (`hangup`|`continue`), `greeting_message` (max 500 chars), `task_prompt` (max 2,000 chars). Optional: `language` (default `en-US`, includes `de-DE`, `fi`-like codes not confirmed), `llm_provider` (`groq` default, or `openai`), `llm_model`, `tts_engine` (`elevenlabs` default or `inworld`), `knowledge_base_text` (max 100,000 chars), `transfer_enabled` and `transfer_number`, `max_duration` (default 180 s), `enable_auto_end`, `webhook_enabled` and `webhook_url`. The LLM is Siptel's (Groq or OpenAI), not our own AI roles.
- **Not documented:** a hangup endpoint for AI agent calls, recording download, inbound call handling, webhook retry behaviour, the `call_status` and `hangup_cause` values, and voice-call pricing.
- **SMS:** `POST /v1/sms/send` with `app_id`, `phone_number`, `sender_id`, `text`. No length limits documented. Siptel can also do SMS.
- **Numbers:** `POST /v1/numbers/search`, `POST /v1/numbers/purchase`, `PUT /v1/numbers/{id}/assign` (to `ai_agent`, `voice_api` or `sip_trunk`).
- **Live audio:** no endpoint accepts a live stream. The SIP trunk exists (`POST /v1/sip/users` creates a SIP user for registration) but the docs don't say how media flows over it. A WebRTC route would need our own gateway registered to that trunk, plus Opus-to-G.711 transcoding. **Unverified** whether Siptel allows it.

## Brevo (first adapter, email and SMS)

Sources: [developers.brevo.com](https://developers.brevo.com) search results. The SMS reference page returned 404 when fetched, so SMS details are **unverified**.

- **Email:** transactional email via the v3 REST API at `api.brevo.com`, authenticated with an `api-key` header. Batch send and scheduled sends exist.
- **Email webhooks:** the official list has 10 event types: sent, clicked, deferred, delivered, soft bounced, spam, first opening, hard bounced, opened, invalid email. Webhooks are managed through the Accounts and Settings API (create, list, get, update, delete, export history).
- **SMS:** the current endpoint is reported as `POST https://api.brevo.com/v3/transactionalSMS/send`, replacing `/v3/transactionalSMS/sms` (deprecated, still working for now). The response is reported as just a `messageId`. **Unverified:** request body fields, sender ID rules, character limits, and whether delivery status is available by webhook.
- **Limits:** one third-party review gives rate limits and a webhook cap of 40. The dev.to article gives 300 requests per minute for the free tier. These conflict and are **unverified**; use the official API reference.
- **Sandbox:** a third-party page describes a sandbox header (`X-Sib-Sandbox`). **Unverified.**
- **Data location:** not checked. Needed before personal data goes there.

## Telnyx (a candidate for a later calling adapter)

Sources: [telnyx EU regional endpoints](https://developers.telnyx.com/docs/account-setup/regional-endpoints), [EU data sovereignty](https://telnyx.com/resources/voice-ai-europe-data-sovereignty), [media streaming](https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming).

- **WebRTC:** Telnyx offers WebRTC calling, which is the main reason it's in the running.
- **Live audio:** Media Streaming forks raw call audio to a WebSocket (inbound, outbound or both). Bidirectional mode can send RTP or MP3 back into the call. This covers the "listen to the stream" requirement, but not in version one.
- **EU:** use `api.telnyx.eu`. The developer docs say processing stays in the EU under normal conditions, but failover can route elsewhere. Setting storage to Germany gives a contractual guarantee for stored data (CDRs, recordings). A Telnyx resilience file says EU data stays in the EU during failover, which conflicts with the developer docs. Get written confirmation.
- **AI features:** Telnyx says there is no guarantee of processing region for AI inference.

## Other options checked

- **Sinch:** voice API with TTS in many languages, ISO 27001 claimed. EU-only processing **unverified**.
- **telli (Berlin):** listed as an EU outbound-calling option with the full stack in the EU. **Unverified**; check the vendor site.
- **Soniox:** EU-processed speech-to-text and TTS with a self-serve DPA. It is not a telephony provider; it would sit beside a carrier.
- **Famulor (Frankfurt):** full AI voice-agent platform with an EU-only region. Platform, not a raw API.
- **Twilio:** has Media Streams, but the search didn't return its documentation.

## Open questions

1. Siptel: can `play-text` use the same TTS engines as the AI agent (`elevenlabs`, `inworld`)? Which voices exist on the account?
2. Siptel: how is a call ended for an AI agent call? Is there a call-end webhook with a payload?
3. Siptel: can a SIP trunk user receive live media from our gateway? Pricing for calls and SMS.
4. Brevo: SMS request body, sender ID rules in Finland, data location, webhook payloads.
5. Brevo and our domain: sender domain, SPF, DKIM and DMARC records.
6. Whether premade sounds are hosted in LCYT's file storage and served at a public URL (needed for Siptel `play-audio`).
7. Consent and data protection: phone numbers and emails are personal data. The notification must have a lawful basis and an opt-out before we send.
