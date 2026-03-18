---
name: accessibility
summary: |
  Accessibility (a11y) skill for UI and TV apps: WCAG guidance, contrast and
  keyboard/D-pad focus, TV-safe typography, testing tools, and remediation
  steps. Use when implementing or auditing UI components, embed widgets, or
  Android TV screens.
---

# Accessibility Skill

## Purpose

Provide a compact, practical workflow for ensuring UI accessibility across the
monorepo (Astro site, React/Vite app, embed widgets, Android TV viewer).
Includes checks, test commands, remediation patterns, and decision points.

## When to use

- Auditing components, pages, or embed widgets for WCAG 2.1/2.2 conformance.
- Adding or changing UI tokens (colors, font sizes) that affect contrast/readability.
- Implementing keyboard and D-pad focus behavior for web and Android TV.
- Writing accessibility tests (Vitest + axe, Playwright accessibility checks).

## Quick checklist

- Contrast: verify text/background contrast ≥ 4.5:1 (normal text) or ≥ 3:1
  (large text). Use automated checks and manual sampling.
- Semantic markup: use appropriate HTML elements (`button`, `nav`, `main`, `h1..h6`).
- ARIA: use ARIA roles only when needed and provide `aria-label` / `aria-labelledby`.
- Focus: visible focus indicator; logical tab order; keyboard-accessible custom widgets.
- Screen reader: verify reading order and labels using NVDA/VoiceOver or `axe` VoiceOver.
- Forms: labels associated with inputs; error messages announced; descriptive placeholders not used as labels.
- Media: captions/subtitles for video; transcripts for audio where applicable.
- Motion: respect `prefers-reduced-motion`; avoid motion that may cause vestibular issues.
- TV-specific: large default font, high-contrast theme, generous spacing, D-pad focus states.

## Testing tools & commands

- Axe (browser extension) — quick manual audits.
- axe-core + Vitest: run unit accessibility checks in component tests.
  - Example: `npm run test:components` (package may already include Vitest config)
- Playwright accessibility snapshot: use `page.accessibility.snapshot()` in E2E tests.
- Lighthouse accessibility audit (Chrome): `npx lighthouse http://localhost:3000 --only-categories=accessibility`.
- Contrast check CLI: `npx color-contrast-checker` or use `axe` results.

## Example Vitest + axe integration

1. Install: `npm i -D @axe-core/playwright @testing-library/react vitest`.
2. In component test:

```js
import { render } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';
import { axe } from 'jest-axe';

test('component is accessible', async () => {
  const { container } = render(<MyComponent />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

(Adjust to whatever test runner is used; the monorepo uses Vitest + testing-library in many places.)

## Remediation recipes

- Contrast failures: consult `design-tokens` and choose a darker/lighter token, prefer token-based changes over ad-hoc color edits.
- Missing labels: add visible `<label>` or `aria-label`; avoid relying on `title` attributes.
- Keyboard traps: ensure custom widgets expose `tabindex`, `role`, and keyboard handlers; document expectations for focusable components.
- D-pad focus: ensure focus targets are large/tappable elements and that focus movement is predictable (use roving tabindex pattern for grids/lists).
- TV typography: increase base font-size (e.g., use CSS variable `--tv-font-size`) and provide a high-contrast theme.

## Decision flow

1. Is the issue visual (contrast, sizing) or structural (markup, semantics)?
   - Visual → propose token change + examples + visual preview.
   - Structural → propose markup/ARIA patch + unit test.
2. Is it platform-specific (TV only) or shared? 
   - TV-only → update `android/lcyt-tv` and `packages/lcyt-web` TV theme.
   - Shared → update design tokens and component adapter.
3. Does the change require migration (breaking CSS vars)?
   - Yes → produce migration notes, preview page, and a small rollout plan.

## Quality criteria / Done

- Automated accessibility checks (axe) pass in component tests or have documented exceptions.
- Manual sampling with Lighthouse/axe extension shows no critical failures.
- TV screens readable at 2m viewing distance (large text verification) and D-pad flows tested on emulator/device.
- Changes are tokenized when they affect color/spacing; no ad-hoc hardcoded values remain.
- PR includes accessibility notes and testing commands in PR description.

## Outputs this skill can produce

- `SKILL.md`-style checklists for PR reviewers.
- Example tests (Vitest + axe) or Playwright accessibility assertions.
- Token-change patches and preview pages (Astro/Storybook snippets).
- Remediation patch with step-by-step verification commands.

## Example prompts

- "Audit `packages/lcyt-web/src/components/InputBar.jsx` for a11y — produce checklist and a patch."
- "Add Vitest+axe test for `Button` component and fix focus outline color to meet contrast."
- "Create TV-high-contrast theme and preview page for DSK overlay templates."

---

Notes

- This skill is not a substitute for legal accessibility audits or professional UX research; use as an engineering-focused checklist and remediation helper.
