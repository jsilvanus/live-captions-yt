# Files To Check After Adding A Feature

1. [CLAUDE.md](CLAUDE.md) — Reason: repo overview and high-level architecture may need updating for new features. Automation suggestion: add doc checklist item to PR template. Priority: Medium  
2. [docs/env-vars.md](env-vars.md) — Reason: new env vars or config flags must be documented. Automation suggestion: generate env var diff in release notes. Priority: High  
3. [scripts/deploy.sh](scripts/deploy.sh) — Reason: deployment steps or build flags changed. Automation suggestion: dry-run deploy script in CI staging. Priority: Medium  
4. [Dockerfile](Dockerfile) and [docker-compose.yml](docker-compose.yml) — Reason: image build context, env vars, or service additions. Automation suggestion: rebuild images in CI and run smoke compose up. Priority: High  
4. Tests `/packages/**/test/`
5. Docs `/docs/`
  - after web app changes, `/docs/guide-web`
 - after core library changes, `/docs/lib/`
 - after CLI changes, `/docs/guide-cli/`
 - after MCP changes, `/docs/mcp/`
 - after any other changes (backend, plugins, orchestrator, etc.), `/docs/api/`
 
Produced by Codebase Expert and edited by jsilvanus.
