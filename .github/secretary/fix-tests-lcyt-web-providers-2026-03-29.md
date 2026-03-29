Branch: fix/tests/lcyt-web-providers-2026-03-29

PR Title: Fix lcyt-web tests — provider wrapping & dashboard widget mocks

Description:
This PR adds a small test helper and minimal test adjustments to address failing
frontend tests caused by missing provider wrappers and inconsistent dashboard
widget mocks. The helper centralises wrapping components with the `AudioProvider`
so tests using `useAudioContext` no longer throw when the hook expects a
provider. The Dashboard test is updated to use the new helper.

Files changed:
- packages/lcyt-web/test/test-utils.js (new)
- packages/lcyt-web/test/components/DashboardPage.test.jsx (updated to use helper)

How to apply these patches and create the branch locally:

```bash
git fetch origin
git checkout -b fix/tests/lcyt-web-providers-2026-03-29
# apply patches (or run the provided script that the Secretary agent created)
git add packages/lcyt-web/test/test-utils.js \
  packages/lcyt-web/test/components/DashboardPage.test.jsx
git commit -m "test: add renderWithProviders helper and use in Dashboard tests"
git push -u origin fix/tests/lcyt-web-providers-2026-03-29
``` 

PR checklist:
- [ ] Add `renderWithProviders` test helper to centralise common providers.
- [ ] Update failing tests to use the helper where components require providers.
- [ ] Ensure existing global mocks (setup.vitest.js) remain compatible.
- [ ] Run `npm test -w packages/lcyt-web` and verify tests pass locally.
- [ ] Request review from `frontend-engineer` and merge after CI green.

Notes:
- This change is intentionally minimal to keep the review surface small. If
  additional tests fail due to other missing context providers (Connection,
  Toast, etc.), expand `renderWithProviders` to include them.
