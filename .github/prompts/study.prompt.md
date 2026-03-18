---
name: study
summary: Quick research + repo-check prompt — fetch web sources and relevant repo excerpts.
applyTo:
  - "docs/**"
  - "packages/**/src/**"
  - "packages/**/test/**"
  - "*.md"
  - "README.md"
whenToUse: |
  - Use `/study topic=<topic>` to run a short research sweep on a public topic and check the codebase for related symbols.
  - Use when you want a concise summary, numbered sources, and any repo file excerpts that match.
args:
  - name: topic
    required: true
    description: The research topic or query (plain text).
  - name: codeSymbol
    required: false
    description: Optional repo symbol or filename to search for (e.g., `HlsManager`).
  - name: topN
    required: false
    default: 5
    description: Number of web pages to fetch and summarize.
---

Description:
Run a web-research sweep for `topic` (top `topN` results), fetch pages, extract short citations (title + URL + 1-line excerpt), and produce a concise executive summary (≤200 words). If `codeSymbol` is provided, search the repository for matching files and include up to 3 file excerpts (path + line range + snippet).

Example invocations:
- `/study topic="YouTube caption ingestion limits"`
- `/study topic="ffmpeg HLS segmenting" codeSymbol=HlsManager topN=3`

Expected output format:
1) Executive summary (<=200 words)
2) Key findings (bulleted)
3) Numbered web sources: title — URL — retrieval date — 1-line excerpt
4) Repo excerpts (if `codeSymbol` provided): `path` (Lx-Ly) — snippet
5) Appendix: search queries used and top URLs fetched

Notes:
- This prompt respects `web-researcher` and `research-synthesizer` skills; it will not access private or paywalled content.
- For longer research tasks, run the `research-synthesizer` agent instead.
