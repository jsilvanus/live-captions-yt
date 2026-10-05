# Camera perception (operator guide)

LCYT can watch the camera feeds with a small, fast person detector and use what it sees for cues, the AI roles and the
vertical crop. This page is the short operator view; the design is in `docs/plans/plan_perception_completion.md`.

## What runs

| Part | What it does | Where |
|---|---|---|
| Detector job | Reads a camera's (or the program) stream, finds **people** as boxes, tracks them with an id, scores the framing. About 5 detections per second. | an fffleet worker (`docker/lcyt-perception-worker`) or the in-process fallback |
| Feed attributor | Says **which camera is on the program feed**: from mixer/PTZ signals, else by matching the picture with your reference images, else `unknown`. | the backend (needs no worker) |
| Aggregator | Turns detections into World State, cue input (`person@left`, `preacher@left`) and interest events. | the backend |
| Describer / Tracker | The slower vision-model roles. They get the camera tag, what the detector sees, and are called at once when something happens (a person enters, framing worsens). | the backend |
| Crop auto-follow | Optional: keeps the vertical crop window on the people in the camera on program. | the backend |

## Setting up

1. Run a perception worker: `FFFLEET_EXECUTORS=lcyt-compute/perception/fffleet-executor`, with `onnxruntime-node` and a YOLOX model
   (`PERCEPTION_MODEL_PATH`). `PERCEPTION_STREAM_BASE_URL` must be reachable **from the worker** (for example `rtsp://mediamtx:8554`).
2. Camera with its own feed: switch **auto** on in AI Observability, Cameras and perception (the job then follows the feed's live state), or press Start.
3. Camera that is only an input of the mixer (no feed of its own): use the **program feed job** (also with auto). The backend tags each
   detection with the camera that was on at capture time.
4. If the mixer does not tell LCYT which input is live, hold a preset button in the production console while that camera shows the shot you
   want recognised (one reference image per camera and preset), then start **visual matching**. A shot that matches nothing clearly is `unknown`, never a guess.
5. Vertical crop: Settings, "Auto-follow people".

Environment variables are listed in `.env.example` (`PERCEPTION_*`, `FEED_*`, `VISION_TRIGGER_GAP_MS`, `CROP_FOLLOW_ROLES`).

## Reading the status panel

AI Observability shows per camera whether its detector runs, whether it starts automatically, if it is on program, and what it last saw
(people, roles, framing, age of the last report). A camera that stops reporting is marked not visible after `PERCEPTION_STALE_MS` (6 s).
After a backend restart running jobs are re-attached, not duplicated.

## Privacy

Perception only produces **boxes around people** (label `person`) and a short-lived track number. There is no face recognition, no identity,
no per-person history and **no frames are stored or logged**. The slower roles (Describer, Tracker) send a still image to the AI provider the
project configured, as they did before. A congregation that films its services may want to mention automated camera analysis in its privacy
notice, because worship attendance can reveal religious belief, which GDPR treats as special-category data.

## Not verified yet

Native `onnxruntime-node` and the worker Docker image have not been built or run against a real service; a remote worker reaching the stream
URL, the tracker and framing thresholds, and the visual matching thresholds are untuned. Treat the first services as a trial.
