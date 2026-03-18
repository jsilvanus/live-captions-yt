---
name: security-engineering
summary: |
  Security Engineering skill: auth flows, rate limiting, input validation,
  threat modelling, and secrets handling.
---

## Purpose
Security best practices tailored to the repo: JWT, API keys, rate limits,
and secure secrets storage.

## When to use
- Reviewing auth flows, hardening endpoints, or designing secrets handling.

## Checklist
- Validate inputs and sanitize before DB writes.
- Apply rate limits to public endpoints and abuse-prone routes.
- Use constant-time comparison for API keys; rotate secrets periodically.
- Store secrets in Vault or CI secrets; avoid checking into repo.

## Commands
- Run static analysis or dependency vulnerability scans (e.g., `npm audit`).

## Outputs
- Threat model notes, rate-limit configs, secrets policy snippets.
