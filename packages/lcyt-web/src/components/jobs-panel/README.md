# Jobs panel (shared component, copied between apps)

A top-bar badge and drop-down that lists queued, running and recently finished jobs, with a one-line fleet strip
(`fleet 3w · slots 5/8 · queue 2 · hetzner 1/5 · app 1 run / 4 queued · stt 1 queued`) and an optional cancel button.

**This component exists in more than one place and is copied, not shared.** There is no single source of truth and no
shared package on purpose. Known copies:

| App | Folder |
|---|---|
| SaarnaVideo (jsilvanus/saarnavideo) | `src/components/jobs-panel/` (TypeScript) |
| LCYT (this repo) | `packages/lcyt-web/src/components/jobs-panel/` (JSX, no TypeScript) |

When you change one copy, look at the others and port what fits. Keep the file names and the props below the same so a
change can be carried over by diff.

## Files

- `JobsPanel.jsx`: the badge, the drop-down and the polling. Everything app-specific comes in through props.
- `job-panel.js`: pure helpers (`isActiveJob`, `jobPercent`, `jobDetail`, `formatJobAge`, `pollInterval`; the `PanelJob` and `Translate` types are JSDoc typedefs here).
- `fleet-strip.js`: `fleetStripParts`, `summariseFleet` (the strip from an fffleet orchestrator's answers).
- `JobsPanel.module.css`: styles.
- Tests: Vitest, in `packages/lcyt-web/test/components/jobs-panel/` (`job-panel.test.js`, `fleet-strip.test.js`, `JobsPanel.test.jsx`); SaarnaVideo keeps them next to the source.

## Differences between the copies (port by hand)

- **Language:** `.tsx`/`.ts` in SaarnaVideo, `.jsx`/`.js` (JSDoc) in LCYT. Code is otherwise the same line by line.
- **Styles:** LCYT's CSS uses its theme tokens (`--color-*` with SaarnaVideo's colours as fallbacks) and has no `prefers-color-scheme` block; the button is smaller to fit LCYT's 48 px top bar.
- **`live` in the strip (LCYT only):** `FleetStripData.live` (number or null) adds `live translation N` (key `fleetStrip.live`) for the live sessions LCYT runs on the speech-to-text service. SaarnaVideo has no such thing; port it if it gets one.
- **Cancel:** both apps pass `cancelJob`; LCYT's backend marks every row `cancellable: false` today (its allow-list is empty), so no button shows there until a finite batch job is allow-listed.

## Props (`JobsPanel`)

| Prop | Meaning |
|---|---|
| `t(key, params?)` | Translate function. Keys below. `{name}` placeholders are filled from `params`; the badge title is `jobs.badge` with `{count}` (an app with plural support can map it to `_one`/`_other`). |
| `loadJobs()` | Resolves `{ jobs: PanelJob[], counts: { running, queued } }`; throw to show "could not load". |
| `loadStrip?()` | Resolves `{ enabled: true, ...FleetStripData }`, `{ enabled: false }` or null; leave out for no strip. |
| `cancelJob?(job)` | Cancels a job; leave out for no cancel button; throw on failure. The panel asks "Cancel this job? Yes / No" inline first (`canCancelJob`, `nextConfirm` in `job-panel`), and offers the button only when `job.cancellable !== false`. |
| `typeLabel?(type)` | Display name of a job type; default is the raw type. |

`PanelJob` = `{ id, projectId, projectTitle, type, status, phase, progress, message, error, workerId, cancelRequested, cancellable?, mode?, createdAt, startedAt, completedAt }`
`cancellable?: boolean`: the backend's decision (false = never show cancel; absent = allowed). `mode?: 'pull' | 'push'`: live rows only; pull = the service pulls the stream itself (auditor `/v1/live`, rtsp/srt), push = LCYT sends it the audio; shown as a tiny arrow (`modeSymbol`: down = pull, up = push, `.mode` class) with `aria-label`/`title` from `jobs.mode.*`. (ISO strings; `projectTitle` is whatever names the owner of the job in that app).

## Message keys

`jobs.title`, `jobs.open`, `jobs.close`, `jobs.empty`, `jobs.badge`, `jobs.cancel`, `jobs.cancelling`, `jobs.cancelFailed`,
`jobs.loadFailed`, `jobs.cancelRequested`, `jobs.cancelConfirm`, `jobs.cancelYes`, `jobs.cancelNo`, `jobs.mode.pull`, `jobs.mode.push`, `jobs.section.active`, `jobs.section.recent`, `jobs.ago.s|m|h|d` (`{n}`),
`jobStatus.QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED` (more statuses are fine: unknown ones should fall back to the raw
status in the app's `t`), and `fleetStrip.offline|workers|slots|queue|draining|local|localWorkers|lanes|app|stt|sttBusy` (+ `live` in LCYT).
English texts are in SaarnaVideo's `src/i18n/messages/en.ts` and LCYT's `packages/lcyt-web/src/locales/en.js` (`jobs`, `jobStatus`, `fleetStrip`).

## LCYT wiring

`src/components/JobsIndicator.jsx` (mounted in `TopBar`, `components/sidebar/Sidebar.jsx`, while a session is connected):
`GET /jobs` and `GET /jobs/strip` on lcyt-backend with the session token. LCYT has no job table, so the rows are the
project's running ffmpeg runs (`type: FFMPEG`, `projectTitle` = the purpose, `workerId` = runner `spawn|local|fleet`) and its live session on the
liturgos-auditor STT service (`type: AUDITOR_LIVE`). Server side: `packages/lcyt-backend/src/routes/jobs.js`,
`packages/lcyt-compute/src/jobs-panel.js`, `fleet-status.js`, `ffmpeg/run-registry.js`.
The SaarnaVideo wiring is `src/components/JobsIndicator.tsx`, `src/app/api/jobs/route.ts`, `src/app/api/fleet/status/route.ts`, `src/lib/fleet-status.ts`.
