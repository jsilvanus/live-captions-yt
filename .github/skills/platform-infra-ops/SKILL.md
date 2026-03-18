---
name: platform-infra-ops
summary: |
  Platform / Infra Ops skill: nginx reverse-proxy, TLS automation, backups,
  and deployment patterns for production.
---

## Purpose
Operational runbooks for deploying, securing and backing up LCYT services.

## When to use
- Adding nginx config, TLS automation (Let's Encrypt), backup/restore scripts.

## Checklist
- Use reverse-proxy with secure headers and HSTS.
- Automate TLS via certbot or ACME client in CI/CD.
- Regular DB backups and verify restore in staging.

## Commands
- Example: test nginx config `nginx -t -c /path/to/nginx.conf`.

## Outputs
- Sample nginx snippets, backup commands, and deployment checklist.
