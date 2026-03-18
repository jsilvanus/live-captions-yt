---
name: research-synthesizer
summary: |
  Research Synthesizer skill: orchestrate parallel research runs across web
  researchers, code-aware agents, and domain experts; aggregate results,
  surface agreements/disagreements, and produce a concise, cited synthesis
  with recommended next steps and an appendix of raw outputs.
---

## Purpose
Provide a reproducible workflow to run multiple research agents in parallel,
collect their outputs (web sources, repo excerpts, agent summaries), and
produce a single synthesized deliverable suitable for decision-making.

## When to use
- You need a consolidated literature survey, feature comparison, or policy
  analysis assembled from many sources.
- You want combined web + repo evidence with explicit citations and an
  actionable recommendation list.

## Quick checklist
- Define a small set of specialized agents to run (e.g., `web-researcher`,
  `web-researcher-code`, `security-agent`).
- Run agents in parallel using `runSubagent`/`search_subagent`.
- Collect raw outputs and normalize into a common structure: {agent, summary, sources, excerpts}.
- Produce:
  - Executive synthesis (≤ 300 words)
  - Key consensus items (bulleted)
  - Conflicts / open questions (numbered)
  - Recommended next steps (assigned to agents)
  - Appendix with full outputs and citations

## Tools & approach
- Use `runSubagent` to invoke multiple research agents in parallel.
- Use `fetch_webpage` / `semantic_search` / `read_file` for additional lookups.
- Structure outputs into a short executive summary and an appendix JSON for reproducibility.

## Constraints
- Executive summary ≤ 300 words; appendix may be longer.
- Always include per-agent raw outputs (or a link to where they are stored).
- Mark unsupported claims as `unverified` and flag contradictions explicitly.
- Respect rate limits and site terms when fetching web pages.

## Output format
1. Executive summary (≤ 300 words)
2. Key findings (3–6 bullets)
3. Conflicts / discrepancies (numbered, with source refs)
4. Recommendations (each mapped to an agent and suggested next step)
5. Appendix: per-agent outputs, full source list (title + URL + date), repo file excerpts

## Example prompts
- "Synthesize: how other services handle HLS subtitle segmenting and trade-offs; include repo evidence if present."
- "Synthesize: public guidance on YouTube caption ingestion + any conflicting community notes."

## Example invocation (high-level)
1. Director defines agents to run: `web-researcher(query)`, `web-researcher(code: "HlsManager")`, `security-agent(query)`.
2. Use `runSubagent` to execute them in parallel.
3. Aggregate outputs, detect overlaps/conflicts, and produce the synthesis.

Notes
- The synthesizer is orchestration-first: it does not implement fixes itself, it assigns follow-ups to named agents.
- For reproducibility, include the exact `runSubagent` payloads and timestamps in the appendix.