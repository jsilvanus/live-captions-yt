---
title: "Commit Prompt Template"
description: |
  We will generate a commit to main, or if requested, to a feature branch. The agent should detect which files it changed, stage only those files, create a concise commit message, and optionally push the branch. The agent must report the exact git commands used and the resulting commit hash and message.
agent: ask
model: GPT-5 mini (copilot)
tools: [execute, read, edit]
---

# commit prompt
Purpose: Instruct a coding agent how to commit the files it changed.

Inputs (use when invoking):
- task: short title describing the change (one line)
- filesChanged: optional list of file paths the agent modified (if known)
- branchPreference: either `main` (default) or a feature branch name
- commitMessage: optional commit message; if not provided, agent should synthesize one
- push: boolean (false by default) — whether to push to the remote after commit

Behavior / Steps the agent MUST follow:
1) Detect what files were changed by the agent. Prefer `git status --porcelain` or the provided `filesChanged` list. Only stage and commit those files.
2) If `branchPreference` is a feature branch name (not `main`), create and switch to that branch (e.g., `git checkout -b <branch>`), then commit there. If `branchPreference` is `main` or omitted, commit on `main`.
3) Stage only the changed files: `git add -- <files...>` (do not add unrelated files).
4) Create a single commit using the provided `commitMessage` or synthesize a concise message following this pattern: `<area>: <short description>` (e.g., `dashboard: prevent widget drag when layout locked`). Use present-tense verbs and keep it to ~50 chars for the subject.
5) If `push` is true, push the branch to the remote: `git push origin <branch>`.
6) Return a concise report showing: branch name, commit short hash, committed files list, the exact `git` commands run, and suggested next steps (e.g., open PR or push).

Constraints / Safety:
- Do not stage or commit files the agent did not intentionally change.
- Avoid force-pushing or rewriting published history.
- If any staged file appears surprising, pause and ask the user before committing.

Output format (agent reply after committing):
- Branch: `<branch>`
- Commit: `<short-hash> <commit message>`
- Files committed: list of paths
- Commands run: show the exact `git` commands used
- Next steps: one-line suggestion (e.g., `git push origin <branch>` or `Create PR from <branch>`)

Examples:
- Commit to main (default):
  - Inputs: `{ task: "fix dashboard drag", branchPreference: "main", commitMessage: "dashboard: lock layout drag" }`
  - Behavior: stage modified files, commit on `main`, report commit hash, do not push unless `push:true`.

- Commit to feature branch:
  - Inputs: `{ task: "dashboard-lock-fix", branchPreference: "feature/dashboard-lock", commitMessage: "dashboard: prevent drag when locked", push: true }`
  - Behavior: create `feature/dashboard-lock`, stage files, commit, push branch, return push command and PR suggestion.

Iteration guidance:
- If the agent cannot run git (permissions or repo not present), it should produce the exact sequence of commands to run locally and the patch (apply_patch) for review.
- When uncertain which files to include, ask a single clarifying question listing the candidate files.

Where to save: repository root as `.prompt.md` (this file).

