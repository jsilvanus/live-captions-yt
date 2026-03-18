---
name: ci-cd-releases
summary: |
  CI/CD & Releases skill: GitHub Actions workflows, semantic versioning, and
  automated publishing strategies.
---

## Purpose
CI patterns for running tests, building packages, and publishing releases.

## When to use
- Adding a workflow to run tests across workspace or to publish npm/PyPI packages.

## Checklist
- Run `npm test` and `pytest` where applicable; fail fast.
- Use semantic-release or manual changelog generation for releases.
- Build artifacts in CI and attach to releases; sign where required.

## Commands
- Example: run CI locally with `act` or reproduce steps locally via scripts.

## Outputs
- Workflow templates, release notes checklist, prerelease tagging guidance.
