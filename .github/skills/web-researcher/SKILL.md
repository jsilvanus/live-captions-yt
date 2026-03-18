---
name: web-researcher
summary: |
  Web Researcher skill: search public web sources, fetch pages, and produce
  concise, cited summaries with links and short annotated excerpts. Also can
  inspect the local codebase for repository-backed evidence.
---

## Purpose
Provide a tested workflow for performing web research and returning a small,
credible digest with sources. When the research touches the repo, include
workspace-relative file citations and short code excerpts.

## When to use
- Collect public documentation, official specs, or authoritative articles.
- Produce a short annotated bibliography for a topic (<= 10 sources).
- Verify claims by checking the repository codebase and tests.

## Quick checklist
- Prefer primary sources (official docs, standards, vendor docs).
- Record exact URLs and page titles for each claim.
- Include retrieval date and short excerpt (1–2 sentences) from each source.
- For repo evidence, include file path and an excerpt (with line numbers).

## Tools & commands
- Use `fetch_webpage` to retrieve page content and `search_subagent` to find candidate pages.
- Use `semantic_search` / `grep_search` / `read_file` to locate relevant repo files.

## Constraints
- Keep executive summary ≤ 200 words.
- Provide a numbered sources list (title + URL + date).
- Mark unsupported claims as `unverified`.
- Do not access private or paywalled content without explicit approval.

## Outputs
- Executive summary (≤ 200 words)
- Key findings (bulleted)
- Numbered sources with title, URL, retrieval date
- Appendix (per-agent raw outputs or repo file excerpts)

## Example prompts
- "Research: YouTube live caption ingestion limits; cite Google docs and any community notes."
- "Find: ffmpeg HLS segmenting best practices and show authoritative references."
- "Search repo: where is `HlsManager` defined and summarize its segment duration logic."

## Example invocation
- `search_subagent: "YouTube caption ingestion API limits"` → fetch top 5 pages → summarize.

Notes
- For reproducibility, include the search query and the top URLs fetched in the appendix.
- For heavy research, gather initial candidate links, then re-run focused fetches for high-value pages only.