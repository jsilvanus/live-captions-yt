# lcyt-notify

Notification core for LCYT (see `docs/plans/plan_notify_channels.md`).

- `src/notify-service.js`: the only caller of channel adapters. Applies consent, active flag, address and provider checks, a per-contact+text cooldown and per-contact hourly/daily caps, and logs every attempt through `onLog`. Provider errors are returned as results, never thrown.
- `src/rate-limit.js`: sliding-window limiter and cooldown (in memory, per process).
- `src/brevo-email.js`: Brevo transactional email adapter (`POST /v3/smtp/email`). Key only in the `api-key` header; errors never contain it.

Tests: `npm test -w packages/plugins/lcyt-notify`. No DB, routes or UI here yet.
