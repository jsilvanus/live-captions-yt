---
name: Codebase Semantics MCP
description: |
  Skill for using the Codebase Semantics MCP to index a local repository, reindex
  changed files only, and perform semantic searches. Covers starting the MCP
  container (as defined in `.vscode/mcp.json`), indexing, re-indexing, query
  patterns, and troubleshooting common connectivity and resource issues.
---

# Overview

This skill documents the recommended workflow for using the Codebase Semantics
MCP (the MCP instance described in `.vscode/mcp.json`) to index the project
mounted at `C:/Users/jsilv/Code` (exposed inside the container as `/projects`).

Use this skill when you want to:
- Create or update a semantic index for a repository
- Re-index only changed files (fast incremental indexing)
- Run semantic searches over the indexed project using the `search` tool

# Prerequisites

- Docker (or an environment able to run the `docker run` command in
  `.vscode/mcp.json`).
- The MCP container in `.vscode/mcp.json` is configured to mount the local
  codebase at `/projects` and set `OLLAMA_BASE_URL` for model access.
- The agent using this skill must be able to reach the running MCP process
  (stdio or HTTP transport as configured).

# Quick start

1. Start the MCP container exactly as shown in `.vscode/mcp.json` (adapt the
   command if you run it manually). Example (from the workspace):

   docker run --rm -i --network mcp-net -e OLLAMA_BASE_URL=http://ollama:11434 \
     -v codebase-semantics-mcp_mcp-data:/data \
     -v C:/Users/jsilv/Code:/projects:ro codebase-semantics-mcp:latest

2. Ensure the MCP process is running and the container has access to the
   mounted project directory `/projects` (read-only mount is sufficient for
   indexing).

# Indexing a project

- Primary operation: index the project root by giving the MCP a unique project
  name and the absolute path inside the container. The MCP supports incremental
  indexing — only changed files are re-indexed when you re-run the index
  operation for the same project name.

Example (conceptual): call the MCP index tool with these parameters:

- name: `live-captions-yt`  (unique project id used for subsequent searches)
- path: `/projects` (the mounted repo path inside the container)

If you are driving the MCP from an agent or script, call the MCP index API or
use the `mcp_codebase_sema_index_project` helper with `name` and `path`.

# Re-indexing changed files only

The MCP indexer is incremental. Re-running the same index command with the
same `name` and `path` performs a delta-index: it walks the repository and
indexes only files that changed since the last run. This keeps subsequent
indexing runs fast and cheap.

# Semantic search usage patterns

Once a project is indexed, use the semantic search tool exposed by the MCP to
ask code-aware questions. Good queries are short, focused, and include role
context. Examples:

- "Find functions that create YouTube caption payloads in the backend"  
- "Where is the DSK caption metacode parsed? Show file and function."  
- "Search for 'startRenderer' usages and return the definition and callers."  

When possible, include keywords that appear in the repository (symbols,
filenames, or code comments) to improve recall.

# Example agent prompts (how you call the skill)

- "Index the repository at /projects as project name 'live-captions-yt'"
- "Reindex project 'live-captions-yt' and report files changed"
- "Run a semantic search in project 'live-captions-yt' for 'caption processor'"

# Quality checks and signals

- Index success: the MCP reports a project entry and the number of files/AST
  chunks indexed.
- Reindex delta: MCP reports how many files were changed / reindexed.
- Search quality: the top results should include file path, code snippet, and
  a relevance score or short justification from the semantic tool.

# Troubleshooting

- Connectivity (VS Code vs container/WSL):
  - If the agent cannot talk to the MCP, confirm the container is running and
    the agent process is launched from the same environment (Remote‑WSL or a
    container shell) or that the transport configured in `.vscode/mcp.json` is
    reachable by the agent.
  - For stdio transport, run the exact `docker run` command from the same shell
    environment that launches the agent so stdio is connected.

- Cold-start/model load times:
  - Large models (gpt-oss:20b) can take many seconds or minutes to load. If
    you see "waiting for server to become available" in logs, wait until the
    runner reports it is ready. Consider keeping the container warm between
    interactive sessions or using a smaller model for fast queries.

- Resource limits:
  - If indexing or queries are slow, check Docker/WSL resource limits (CPU,
    memory). Increase available RAM/CPUs to the container if needed.

# Implementation notes for integrators

- Always mount the repository read-only into the MCP container when you only
  need to index and search; this reduces accidental writes and simplifies
  permissioning.
- Use stable project `name` values (e.g., repo name or slug) so re-indexing
  performs delta updates.
- For CI or scheduled indexing, call the MCP index operation from a scheduled
  job; reindexing unchanged projects is cheap but can still cost CPU time.

# Example troubleshooting commands

Run inside the host or WSL shell used to start the MCP container:

docker run --rm -i --network mcp-net -e OLLAMA_BASE_URL=http://ollama:11434 \
  -v codebase-semantics-mcp_mcp-data:/data \
  -v C:/Users/jsilv/Code:/projects:ro codebase-semantics-mcp:latest

Check container logs (if using a named container instance):

docker logs <container-id>

# Suggested follow-ups and prompts to try

- "Index the repo at /projects as 'live-captions-yt' and confirm file count."
- "Show me the top 5 files relevant to 'stt-manager' with short explanations."
- "List changed files since the last index for project 'live-captions-yt'."

---
Created-by: agent-customization skill template
