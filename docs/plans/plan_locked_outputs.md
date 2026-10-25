# Locked outputs: several outputs, one ffmpeg

**Status (2026-10-25): v1 built in one PR (DSK and plain outputs; crop and direct mode left out), nothing verified against a real MediaMTX, fleet or two-instance run.**

What was built, and where it differs from the plan below:
- `src/output-group-plan.js` (`buildGroupArgs`, pure): one ffmpeg, members with the same leading viewports share the composite and `split`; `buildDskStepArgs` is its one-member case, so an unlocked output is unchanged.
- `output_groups` table and `outputs.group_id` (both schemas, Postgres migration `0015_output_groups.sql`; the group has no `enabled`/`preset` column, dissolving a group is the way to unlock). Lock rules live in `db/outputs.js` (`createGroup`, `checkGroupMembers`, `dissolveGroupIfSmall`): same input path, no crop, same project, at most `outputs.max_group_members` (`MAX_GROUP_MEMBERS`, default 4), a group of fewer than two dissolves.
- `OutputStepManager` groups the DSK steps of one group that read the same input into one process (`desiredSteps` returns units). A group counts as **one step** against `MAX_OUTPUT_STEPS` (the plan counted distinct filter steps; one process is simpler and the member cap bounds the encodes). A graph change (viewport ready or gone, member added) restarts the whole group once.
- `MEDIAMTX_RTMP_FLEET_BASE_URL` (`mediamtx.rtmp_fleet_base_url`): the RTMP base fleet steps publish to, like the RTSP one.
- API: `GET/POST /outputs/groups`, `DELETE /outputs/groups/:id`, `PATCH /outputs/:id { groupId }`. UI: "Render together with" on the output edit dialog of the Outputs card.
- Not built: crop in a group (later phase, section 4.3), ownership lease per group (the step layer still has none, as before), lifecycle wanted-members rule, direct mode (tee straight to destinations, see "Possible future work").

**Possible future work: direct mode.** The group's ffmpeg could also tee each member straight to its targets (`[f=flv:onfail=ignore]` per target), skipping the MediaMTX hop; a dropped target is retried by a small separate fan-out. It saves one process and one local hop per member, not CPU, and needs the member path anyway for preview, recording and the retry. Decide after measuring the hop on the Windows stack. A related small follow-up: `onfail=ignore` on the fan-out tee targets so one dropping target does not blink the others.

---

## Original plan (2026-10-20)
Status: planning only, nothing built. Asked by Juha on 2026-10-20 ("outputs should be able to be locked to each other, meaning that the same ffmpeg process handles both"). Builds on the merged egress outputs (#401, #403 to #406; plan `egress-outputs-plan-2026-10-19.md`), the three views of one broadcast (broadcast lifecycle plan, section 3, PR #396), MediaMTX fan-out via fleet (#362, `MEDIAMTX_FANOUT_MODE`) and per-key ownership (`ownership.js`). Checked against `live-captions-yt` main at `18543de`; the legacy DSK move PR #407 was not read, so section 6 step 0 re-checks it.

## 1. What "locked" means

Today each output step is its own ffmpeg: DSK step `out-<id>-dsk` (`OutputStepManager`, `output-steps.js`), crop `<apiKey>-crop` or `out-<id>-crop` (`CropManager`). An output built on another output reads the previous step back from MediaMTX over RTSP. Example: Program (feed + DSK) and Vertical (Program + crop) are two ffmpeg runs, two decodes, one RTSP hop between them.

A **lock group** is a set of outputs that share one root input and are compiled into **one ffmpeg process**: decode once, build one filter graph with `split`, and write one encoded rendition per member.

```
-i rtsp://mtx/<feed> -i rtsp://mtx/dsk/<key>__lower3rd
[1:v]colorkey=..[k]; [k][0:v]..overlay[dsk]; [dsk]split=2[a][b]
[b]crop@vcrop<outId>=..,scale=1080:1920[vert]
-map [a] -map 0:a -c:v libx264 .. -f flv rtmp://mtx/out-A-dsk
-map [vert] -map 0:a -c:v libx264 .. -f flv rtmp://mtx/out-V-crop
```

Why Juha would want it, in order of value:
1. **Sync.** In a chain, Vertical trails Program by the hop (encode, MediaMTX, RTSP read, encode), probably one to two seconds (not measured). In a lock group both renditions come from the same decoded frame with the same timestamps. That matters for the same congregation watching on two screens, and for captions, which LCYT sends per stream key with one delay setting.
2. **CPU.** One decode, one shared DSK composite and colorkey instead of one per output. Matters on Hetzner burst workers and on the Windows laptops.
3. **One fleet job, one failure domain, one owner.** One lease per group instead of one per step (the step manager has no ownership yet, see 5).
4. **One restart rule.** The group restarts as a whole when its graph changes, so members never run on different versions of the DSK set.

What it costs: members start, stop and blip together; a graph change in one restarts all (crop position moves stay live, see 4.3); one process uses more CPU than any single step, so it needs a bigger slot.

## 2. Decisions (recommended; change if you disagree)

0. **Manual only, crop out of v1 (Juha, 2026-10-20).** The user decides what is grouped; nothing is locked or suggested automatically. Crop is usually not locked with anything, so v1 groups are DSK and plain outputs only. An output with `crop_enabled` is refused by the eligibility check. Sections 4.3 (crop commands through the group's stdin) and the crop parts of 4.1 and 9 describe a later phase, built only if Juha asks for it; v1 needs no shared stdin.

1. **Lock = a group of outputs, not a new kind of output.** Outputs keep ids, names, relay slots and broadcast membership. Locking only changes which process renders them. Unlocking returns each output to its own step process with no data change.
2. **The group writes each member's normal MediaMTX path** (`out-<id>-dsk`, `out-<id>-crop` or `<apiKey>-crop` for the default crop). Relay slots, preview, `outputSourcePath`, the broadcast outputs and the fan-out (`FanoutSupervisor`, `-c copy` tee) stay exactly as built. The group does **not** write to YouTube itself. Reason: a YouTube target that rejects or stalls would kill a shared process in ffmpeg (a failed muxer output ends the run), and it would couple the two destinations. With MediaMTX in between, the shared process only fails on local publishing, and destination failures stay in the per-path fan-out ffmpegs as today. The price is one RTMP hop on the local machine per member, small compared with the sync gain.
3. **Eligibility rule (checked on write):** all members must resolve to the **same root input path** (same feed, or the same upstream output outside the group) and be in the same project. Audio can differ per member (`audio_source`, see 4.4). Unrelated feeds are refused: locking gains nothing for them and would only couple their failures.
4. **Plain members allowed:** a member with no step (just the feed) can be in a group and is written as `-c copy` of the root input (video and audio). That gives a "raw + processed in one process" case, though the plain case needs no lock (it is already a fan-out), so the UI offers locking only when at least two members have a step.
5. **Out of v1:** CEA-708 (uses ffmpeg stdin for the SRT pipe; crop already uses stdin for commands, one process has one stdin), per-slot transcode renditions (the relay manager has its own multi-encode tee), several crops fed by different crop source maps in one group (see 4.3), cross-feed groups.

## 3. Data model (both Prisma schemas, `sqlite/schema.sql`, next Postgres migration after the current highest)

- New table `output_groups`: `id` (`lg-<12hex>`), `owner_api_key`, `name`, `enabled` (0/1, default 1), `preset` TEXT NULL (x264 preset override, default as steps), `created_at`. Index on `owner_api_key`.
- `outputs.group_id` TEXT NULL (references `output_groups.id`, on delete set null). A group with fewer than two members is dissolved automatically (the row is deleted; the lone member returns to its own step).
- No change to `crop_*`, `rtmp_relays`, `broadcast_outputs`: they key on output id, which does not change.
- Output `enabled` keeps meaning "configured and allowed" (as agreed with the lifecycle plan); running state is runtime, per group.
- Guards on write: same project, same root input (computed with the existing resolver, depth cap 3 already in the egress plan), no member's source is an output outside the group that is itself in a different group (a group may read the final path of another group, which is a normal RTSP read, but not form a cycle), member count cap `MAX_GROUP_MEMBERS` (default 4, setting `outputs.max_group_members`).

## 4. Compiler and runner

### 4.1 Pure compiler

New `lcyt-rtmp/src/output-group-plan.js`, no I/O, golden-tested. `compileGroup(members, ctx) -> { inputs, filterGraph, outputs[], commandTargets, hash, requires }`.

- Reuse, do not copy: `buildDskStepArgs` and the crop filter in `crop-manager.js` (`crop@vcrop=..,scale=..`) are first refactored into fragment builders (`dskFragment`, `cropFragment`: given an input label, return filter parts and an output label). The existing single-output paths then call the same fragments, so a locked and an unlocked output cannot drift apart.
- Build a tree from the members' step chains (order is always source, DSK, crop, as in the egress plan). Common prefixes are shared: members with the same DSK list share one overlay chain, then `split` where they diverge. Members with a different DSK list diverge at the root of the DSK step.
- Per member output: its own `-map`, `-c:v libx264 -preset .. -tune zerolatency` with member-specific size/bitrate, `-c:a copy` (or the audio override), `-f flv rtmp://<mtx>/<path>`.
- `hash` of the compiled graph decides restart: unchanged hash = leave the process alone.
- `requires` = union (`encoder:libx264`, `filter:colorkey`, plus `MEDIAMTX_FLEET_REQUIRES`).

### 4.2 Runner

`OutputStepManager` becomes the owner of both unlocked steps and groups: a step is just a group of one that is not user-visible. It already has restart with backoff, the reconcile poll, a readiness check on the source path and the "restart when the set of ready viewports changes" rule, so the group reuses all of it with the unit of supervision changed from a step to a group. Source not ready: group stops. A viewport not ready: the group runs without it and restarts when it comes (same rule as today). `MAX_OUTPUT_STEPS` counts a group as steps = number of distinct filter steps in the tree (shared steps count once), so locking visibly saves budget. Process count and encode count are reported separately in status.

### 4.3 Crop commands

`CropManager` today sends live position changes to ffmpeg stdin (`C<target> <time> <cmd> <arg>`, target `crop@vcrop`). In a group:
- the group process opens stdin (`stdin: 'pipe'`, supported by both the spawn and fleet runners);
- each crop filter gets a unique instance name (`crop@vcrop-<outputId>`) and `CropManager` addresses its output's target through a `GroupHandle.sendCommand(target, ...)` that serialises writes (one writer at a time);
- on group start, the current positions are applied from the first command or baked into the initial filter, as the crop session does now;
- the restart-mode fallback (stdin unusable) restarts the **whole group**, which is the case to watch: a vertical crop change must not blip the landscape output. If the runner cannot do live commands, the crop of a locked output should refuse to lock (check at lock time with `_stdinUsable`).
Production-follow keeps resolving through the feed link; nothing changes there.

### 4.4 Audio

`audio_source = feed:<id>` adds one more `-i` for that audio feed (shared if two members choose the same one) and the member maps `-map <n>:a`. No mixing, same as the egress plan. Different members may choose different audio, since this is only `-map`. Drift against video is the same open risk as in the egress plan; in a group the video side is at least common.

### 4.5 Relay and fan-out (Juha, 2026-10-20: groups keep the fan-out)

Every member of a group keeps the fan-out to its destinations: one `FanoutSupervisor` tee per member path (`out-<id>-dsk` and so on), exactly as for an unlocked output, so one member can send to several targets (YouTube, Facebook, custom RTMP). The group never publishes to a destination itself (decision 2). Reason, from Juha: connection drops by credentials happen mostly when a stream starts, and after that streams are stable. With the fan-out separate from the shared ffmpeg, such a start-up drop only restarts that member's fan-out (backoff 1 s up to 15 s, runner mode) and never the group, so the other member keeps sending.

What the code does today, read on main: the tee has no `onfail=ignore` (`_buildTeeTargets` writes plain `[f=flv]url`), so when one target of a member drops, ffmpeg ends the tee and the member's **other** targets blink until the supervisor restarts it. Locking does not change that. Proposed small follow-up, not part of the lock work: `[f=flv:onfail=ignore]` per target so one bad target never takes the others down (needs a real ffmpeg check, and the supervisor must still notice when every target is gone).

**Direct mode (asked 2026-10-20, not v1):** the group's ffmpeg could also tee each member straight to its targets (`[f=flv:onfail=ignore]` per target), skipping the MediaMTX hop. A dropped target is removed from the running tee and retried by a small separate fan-out ffmpeg reading the member's path, so the group never restarts for a target. Savings are one process and one local hop per member, not CPU (the fan-out is `-c copy`, almost no CPU; the encodes are the cost and are already shared). Costs: the member path must still exist for preview, recording and the retry, whether `onfail=ignore` also covers a target that fails while opening is unverified, and re-adding a target to a running tee needs a restart. Decide after the Windows measurement of the hop.

Open fan-out items in CONSIDER.md (hook landing on a non-owner instance, orphan reaping) are neither worsened nor fixed here. In `hook` mode the fan-out runs inside MediaMTX on path ready, in `runner` mode on spawn/fleet; both work for group members because they only read the member's path.

## 5. Multi-instance and fleet

- **Ownership:** one lease per group, `proc:output-group:<groupId>`, using `withOwnership` with `claiming: ['start']` and routed `stop`, `sendCommand` (crop moves), `getStatus` via `__read`. This also closes the egress plan's stated gap that every instance would try to run a step: unlocked steps become groups of one with the same lease (`proc:output-group:<outputId-group>`). Requires `INSTANCE_URL` as for relay/crop; not verified on two hosts. With `CLUSTER_PROCESS_OWNERSHIP=0` behaviour is as today.
- **Fleet:** the group is one fffleet job with `stdin: 'pipe'`. Questions to verify, not assumed: (a) slot sizing, because one job now encodes N renditions; check whether the job class or `requires` can express "needs more CPU" and otherwise cap `MAX_GROUP_MEMBERS` by the smallest worker; (b) **gap found while reading:** `OutputStepManager._rtmpBase()` publishes to `mediamtx.rtmp_base_url` with no fleet-reachable variant, unlike RTSP (`MEDIAMTX_RTSP_FLEET_BASE_URL`). On a fleet worker the step would publish to the app host's `127.0.0.1`. Add `MEDIAMTX_RTMP_FLEET_BASE_URL` (default falls back to the plain one) in the first PR, for steps and groups alike; (c) the worker must reach RTSP and RTMP of MediaMTX, which matches both deployment shapes (one LAN, one Hetzner private network).
- Burst autoscaling: a group job is longer-lived and heavier than a download, so it should go to a class that is not preempted by short jobs; check how the orchestrator classes (`class`, `priority` on the runner) are configured.

## 6. Broadcast lifecycle and UI

- **Lifecycle:** a broadcast turns outputs on and off by output id (`broadcast_outputs`). With groups: starting any member starts the group, which brings up all members, so a broadcast that selects only Vertical still renders Program. Rule: the group runs while **any** of its members is wanted by a running broadcast or by manual operation; members nobody wants are dropped from the graph (hash changes, one restart). Pre-flight must show "locked with Program" next to the output and the group's CPU cost.
- **UI (Outputs card, Setup Hub):** per output a "Lock with..." control listing eligible outputs (same root input), shown as a small chain-link badge and a shared colour on the group; unlock button; the group's status line (one process, N renditions, owner instance, last restart reason). Hide the control until at least two outputs have a step. Texts through the existing i18n in lcyt-web. Not browser-tested (nothing is).
- **Quick workflow pages (Juha's other message):** "Send broadcast to multiple targets" can create a locked group by default when a simple page defines several processed outputs from one incoming feed, and a plain multi-target restream stays a single fan-out (copy), which is cheaper still and needs no lock.

## 7. API

`GET/POST/PATCH/DELETE /api/v1/output-groups` (create from a list of output ids, rename, dissolve), plus `PATCH /outputs/:id { groupId }` as the single-output form. `GET /output-groups/:id/status`: state, owner, running ffmpeg summary, members with their paths, last restart reason, skipped members. Handlers delegate to `src/db/outputs.js` (repo convention). Validation errors are readable ("Vertical reads another feed than Program").

## 8. PR order (each sequential, none started)

0. Re-read after #407 merges: where the legacy DSK composite now lives, then decide whether the legacy composite viewport can be a member of a group (assumption: no, it stays in the relay process and is migrated away by #407 and egress PR 3).
1. Refactor only: DSK and crop filter fragments extracted, existing steps and crop call them, unchanged output (arg golden tests prove identical args). Add `MEDIAMTX_RTMP_FLEET_BASE_URL`. No schema change.
2. Schema (`output_groups`, `outputs.group_id`, migrations in both databases, `MAX_GROUP_MEMBERS`), db helpers, eligibility guards, API. Groups exist but nothing runs them differently.
3. `compileGroup` plus the group runner in `OutputStepManager` (unlocked steps become groups of one), group lease and routing, crop commands through the group handle.
4. Lifecycle integration (wanted-members rule, pre-flight lines) and the Outputs card UI.
5. Docs and manual test: `lcyt-rtmp/CLAUDE.md`, `lcyt-backend/CLAUDE.md`, `docs/PLANS.md`, egress plan section update, API docs.

## 9. Tests

- Unit: eligibility and cycle guards; `compileGroup` golden args for (a) DSK shared then crop split, (b) two different DSK lists, (c) audio override per member, (d) plain copy member, (e) two crops; hash stability; wanted-member pruning; group of one equals today's step args exactly.
- Integration with a fake runner (same pattern as the fan-out supervisor tests): start, source not ready, viewport appears, member added, crop command routed to the right target, restart-mode refusal at lock time, lease forwarding with a fake `ownership`.
- Real ffmpeg (CI has ffmpeg): two renditions from a synthetic `testsrc` input to two local sinks; check size, equal timestamps of the first frame (sync claim) and that adding a member restarts once.
- Both databases: SQLite and the Postgres job (explicit timeouts; the Postgres job has had one unrelated flaky test, report it, do not retry blindly).
- Manual on the Windows stack (Juha): Program + Vertical locked, measure the offset between the two YouTube previews against the unlocked chain, CPU compared, crop move while live, unlock while live.

## 10. Risks and open questions

- **Blast radius:** any graph change restarts every member, which cuts the main landscape output to fix the vertical one. The wanted-member rule and the hash reduce needless restarts, but a DSK viewport coming or going still blips both. Decision for you: is that acceptable for locked groups (my recommendation: yes, it is what locking means, and the UI says so)?
- **CPU on one process:** x264 threads per encode share the process; one slow output slows the shared decode and then both. Needs measurement before `MAX_GROUP_MEMBERS` is fixed.
- **ffmpeg stdin and `-re`:** commands over stdin into a multi-output graph need the unique instance names to work as written; not run here.
- **Timestamps into MediaMTX:** two publishers from one process share timestamps, which is the point; MediaMTX behaviour for the RTMP-to-RTSP re-mux of both paths is unverified.
- **Alpha** still does not survive H.264, so viewports must use chroma key (unchanged).
- **Not verified against a real MediaMTX, fleet or ffmpeg multi-output stdin commands.** Everything here is design from reading the code.

## 11. Not in scope

Server-side mixer on the fleet, audio mixer with several inputs per output, audio sync offset, locking outputs from different feeds, locked groups that write directly to destinations (an optional later mode if the extra local RTMP hop shows up in measurements), CEA-708 inside a group.
