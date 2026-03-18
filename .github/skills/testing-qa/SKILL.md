---
name: testing-qa
summary: |
  Testing & QA skill: node:test, Vitest, pytest, Playwright E2E, mocking and flaky
  test mitigation strategies.
---

## Purpose
Testing patterns across the repo and reproducible approaches for unit, integration,
and E2E tests.

## When to use
- Writing new tests, diagnosing flaky tests, or adding E2E Playwright checks.

## Checklist
- Keep unit tests fast and deterministic; use mocks for external services.
- Integration tests may use in-memory DB or temp directories.
- Playwright E2E for user flows (embed widgets, DSK preview, SSE flows).
- Record flaky tests and quarantine with `--grep` or skip until fixed.

## Commands
- Run Node tests:

```bash
npm test
```

- Run Python tests (pytest):

```bash
cd python-packages/lcyt-backend
pytest
```

## Outputs
- Test templates, Playwright scenarios, flaky-test troubleshooting notes.
