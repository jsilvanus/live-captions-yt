# Hidden pages

Pages/nav items removed from the `lcyt-web` sidebar (`packages/lcyt-web/src/components/sidebar/navConfig.jsx`) because they have no counterpart in the current Claude Design mockup (project `9919ac53` — "LCYT", `Sidebar.dc.html` / `Dashboard.dc.html`).

**"Hidden" means nav-only.** The route, component, and backend behavior are all untouched — each page still works if you type its URL directly. Removed only from `NAV_ITEMS` / `NAV_GROUPS` / `NAV_BOTTOM` (and therefore from the Command Palette, which is built from the same config). To bring one back: re-add its entry to `navConfig.jsx` with a fitting icon, in whatever position makes sense once it has a design.

The mockup's sidebar order (Setup → Assets → Planner → Graphics → Broadcast, then Projects → Team → Admin → Account) is what the current nav follows. Everything below was in the old nav but isn't in the mockup yet.

**Update (2026-07-06):** Planner is back in the nav (between Assets and Graphics) — the mockup's `Planner Page.dc.html` was fully ported (structure/outline sidebar, file-include block type, theme-aware CSS). See `packages/lcyt-web/src/components/PlannerPage.jsx`.

## Removed nav items

| Item | Route(s) | Was | Note |
|---|---|---|---|
| Captions | `/captions` | Top nav item | Classic two-panel caption UI — core feature, just not in the mockup yet. |
| Audio | `/audio` | Top nav item | Full-page audio/STT controls. |
| Translations | `/translations` | Top nav item | The mockup's Assets screen has a static `AssetTranslationsCard` — worth wiring a real link there once that card gets an `onClick`. |
| AI | `/ai` | Bottom nav item | AI/embedding provider settings. |
| Settings | `/settings` | Bottom nav item | General/CC/IO preferences. Note: the mockup's Org screen has its own "Setup" tab, but that's team-defaults config (which device/service configs a team pushes into projects), not this page — genuinely no equivalent yet. |
| DSK Control | `/graphics/control` | Sub-item of the old "Graphics" group | The mockup's Graphics icon opens the Editor directly, no sub-menu. |
| DSK Viewports | `/graphics/viewports` | Sub-item of the old "Graphics" group | Same as above. |
| Production — Operator | `/production` | Sub-item of the old "Production" group | Live operator control surface. The mockup has no equivalent screen (distinct from the Setup page's device *configuration* cards). |
| Production — Visual | `/production/visual` | Sub-item of the old "Production" group | |
| Production — Devices | `/production/devices` | Sub-item of the old "Production" group | |
| Admin — Audit Log | `/admin/audit-log` | Sub-item of the old "Admin" group | The mockup's Admin screen has tabs for Site Features / Teams / Projects / Users — no Audit Log tab. |

The "Graphics" and "Admin" sidebar groups were also flattened to single items (pointing at `/graphics/editor` and `/admin/users` respectively) to match the mockup, which shows them as single icons rather than expandable groups.

## Already unlinked (not new — flagging for awareness)

These routes/pages existed before this pass and were **already** not in the sidebar (not part of this cleanup, just noted here since they came up while cross-checking against the mockup):

- `/production/cameras`, `/production/mixers`, `/production/bridges` — standalone camera/mixer/bridge management pages. The mockup's Setup screen already has config *cards* for Cameras/Mixers/Bridges (matching `packages/lcyt-web/src/components/setup-hub/CameraSection.jsx` etc.), so these standalone pages may be redundant once Setup's cards are complete — or may still be needed as what those cards deep-link to. Worth a decision once Setup is fully wired up.
- `/admin/site-features` (`AdminSiteFeaturesPage`) and `/admin/teams` (`AdminTeamsPage`) — these **do** have design counterparts (the mockup's Admin screen tabs "Site Features" and "Teams") but were never linked from the sidebar to begin with. Low-risk follow-up: wire the flattened Admin nav item into an actual tabbed page (Site Features / Teams / Projects / Users) matching the mockup, instead of just landing on `/admin/users`.
