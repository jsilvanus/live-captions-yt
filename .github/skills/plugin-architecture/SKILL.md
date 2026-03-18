---
name: plugin-architecture
summary: |
  Plugin Architecture skill: plugin API patterns, compatibility rules, and
  testing guidance for `packages/plugins/*` packages.
---

## Purpose
Define how plugins should initialize, migrate DB, and expose routers to the
backend while remaining easy to test and maintain.

## When to use
- Adding new plugin routes (DSK, production, etc.) or changing plugin init flows.

## Checklist
- Export `init*()` and `create*Router()` patterns; avoid global side-effects.
- Run plugin DB migrations on init in a safe, idempotent manner.
- Provide mocked adapters for unit tests.

## Outputs
- Plugin templates, testing harnesses, compatibility rules.
