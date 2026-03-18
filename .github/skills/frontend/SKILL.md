---
name: frontend-react-vite-astro
summary: |
  Frontend skill for React/Vite/Astro: component patterns, embed widgets,
  Vitest, hydration, routing, and bundle/performance tips.
---

## Purpose
Practical rules and test scaffolds for `packages/lcyt-web` and `packages/lcyt-site`.

## When to use
- Creating embed widgets (`/embed/*`), improving hydration, or adding routes.
- Writing Vitest + testing-library tests and running component snapshots.
- Improving bundle size, code-splitting, and SSR hydration behaviour.

## Checklist
- Use contexts/hooks for session state; avoid heavy logic in top-level render.
- Embed widgets: minimal runtime, `autoConnect` opt-in, BroadcastChannel messages.
- Test with Vitest + jsdom for hooks; Playwright for E2E interactive flows.
- Perf: lazy-load heavy libs, prefer CSS variables for theme tokens, measure bundle via `rollup`/`vite` analyzer.

## Commands
- Dev:

```bash
npm run web -w packages/lcyt-web
```
- Vitest:

```bash
npm run test:components -w packages/lcyt-web
```

## Outputs
- Component test templates, embed integration checklist, bundle-analysis notes.
