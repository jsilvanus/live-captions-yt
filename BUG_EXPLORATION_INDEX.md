# 🐛 Bug Exploration Results — live-captions-yt

## Quick Summary

**✅ Exploration Complete** — 4 high-confidence, reproducible bugs identified in the session management, caption delivery, and resource cleanup systems.

| # | Severity | Bug | File | Impact |
|---|----------|-----|------|--------|
| 1 | 🔴 CRITICAL | Session ID mismatch on reconnect | `packages/lcyt-backend/src/routes/live.js:247` | Session recovery fails after server restart |
| 2 | 🟠 HIGH | Incomplete metadata persistence | `packages/lcyt-backend/src/store.js:292-301` | Critical fields lost during rehydration |
| 3 | 🟡 MEDIUM | Timestamp format inconsistency | `packages/lcyt-backend/src/caption-fanout.js:79` | YouTube receives unnormalized timestamps |
| 4 | ⚪ LOW | Fire-and-forget cleanup | `packages/lcyt-backend/src/routes/live.js:265` | Resource leaks, unclosed connections |

---

## 📄 Documentation Files

### 1. **BUG_REPORT.md** (13.8 KB) — Authoritative Bug Analysis
**What:** Detailed technical breakdown of each bug.

**Contains:**
- ✅ Root cause analysis with code snippets
- ✅ Triggering scenario and reproduction steps
- ✅ Expected vs. actual behavior
- ✅ Confidence level (8–10/10)
- ✅ Suggested fixes with implementation notes
- ✅ Verification checklist for each fix

**Start here if:** You want to understand the bugs deeply and implement fixes.

---

### 2. **BUG_SUMMARY.md** (10.5 KB) — Executive Overview
**What:** High-level summary of the exploration methodology, findings, and recommended fix priority.

**Contains:**
- ✅ Overview of all 4 bugs in a quick table
- ✅ What was explored (code paths, testing strategy)
- ✅ Impact assessment (user-facing effects)
- ✅ Validation limitations and assumptions
- ✅ Recommended fix priority and effort estimates
- ✅ Next steps for implementation

**Start here if:** You want a quick overview before diving into details.

---

### 3. **RUN_COMMANDS.md** (11.5 KB) — Validation & Reproduction
**What:** Executable commands to reproduce and validate each bug in your environment.

**Contains:**
- ✅ Quick verification scripts (2–5 min each)
- ✅ Integration test scenarios with curl commands
- ✅ Database inspection SQL queries
- ✅ Resource leak detection procedures
- ✅ Expected vs. actual behavior tables
- ✅ Full test suite run commands
- ✅ Manual verification checklist

**Start here if:** You want to reproduce bugs locally or verify the findings in your environment.

---

### 4. **validate-bugs.js** (9 KB) — Automated Quick Check
**What:** Node.js script that validates all 4 bugs automatically.

**How to run:**
```bash
node validate-bugs.js
```

**Output:**
- ✅ Hash collision proof-of-concept for Bug #1
- ✅ Database field inspection for Bug #2
- ✅ Timestamp format analysis for Bug #3
- ✅ Cleanup pattern detection for Bug #4
- ✅ Formatted summary table with status

**Exit code:** 1 if bugs found, 0 if all fixed.

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Verify All Bugs Exist
```bash
node validate-bugs.js
```

Expected output: "🔴 BUG CONFIRMED" for all 4 bugs.

### Step 2: Review Bug Summary
Read `BUG_SUMMARY.md` for architectural insights and priority ranking.

### Step 3: Choose Your Path

**Path A: Understand the bugs (10–15 min)**
- Open `BUG_REPORT.md`
- Read Bug #1 and #2 sections (highest priority)
- Check root cause analysis and suggested fixes

**Path B: Reproduce locally (20–30 min)**
- Open `RUN_COMMANDS.md`
- Follow "Quick Verification" sections for each bug
- Run reproduction scripts to confirm in your environment

**Path C: Implement fixes (5–6 hours)**
- Use suggested fixes from `BUG_REPORT.md`
- Run commands from `RUN_COMMANDS.md` to verify before/after
- Add regression tests to prevent reoccurrence

---

## 🔍 Bug Details at a Glance

### Bug #1: Session ID Mismatch 🔴 CRITICAL
**Problem:** Session ID changes on reconnect when client omits streamKey.

**Scenario:**
1. Client creates session WITH streamKey → SessionID = `hash(apiKey:streamKey:domain)`
2. Server restarts
3. Client reconnects WITHOUT streamKey → SessionID = `hash(apiKey::domain)`
4. Result: Different ID = session recovery fails

**Quick Fix:** Normalize streamKey consistently in `makeSessionId()` — don't default to empty string during reconnection.

**File:** `packages/lcyt-backend/src/routes/live.js:247`

---

### Bug #2: Incomplete Metadata Persistence 🟠 HIGH
**Problem:** Session `touch()` method saves only activity/sequence, not critical metadata.

**Scenario:**
1. Session created with apiKey, streamKey, domain, startedAt
2. Caption sent → `touch()` called
3. Server restarts
4. Session rehydrated from DB → apiKey/streamKey/domain/startedAt are NULL
5. Result: Session unusable, next operations fail

**Quick Fix:** Persist all metadata fields in `touch()` UPDATE statement.

**File:** `packages/lcyt-backend/src/store.js:292-301`

---

### Bug #3: Timestamp Format Inconsistency 🟡 MEDIUM
**Problem:** YouTube targets receive raw timestamp; generic/viewer targets receive ISO string.

**Scenario:**
1. Caption normalized to ISO string `tsStr`
2. YouTube target: `target.sender.send(text, e.timestamp)` (raw, not normalized)
3. Generic target: `POST /url { timestamp: e.tsStr, ... }` (ISO string)
4. Result: Inconsistent payload shape, potential API errors

**Quick Fix:** Pass `e.tsStr` to YouTube targets instead of `e.timestamp`.

**File:** `packages/lcyt-backend/src/caption-fanout.js:79`

---

### Bug #4: Fire-and-Forget Cleanup ⚪ LOW
**Problem:** Cleanup Promise has no guarantee of completion before shutdown.

**Scenario:**
1. Session ends → cleanup triggered
2. `Promise.resolve(t.sender.end()).catch(() => {})` starts but isn't awaited
3. Server shuts down before cleanup completes
4. Result: Unclosed streams, buffers not flushed, resource leaks

**Quick Fix:** Replace fire-and-forget with `await` or `.finally()` block.

**File:** `packages/lcyt-backend/src/routes/live.js:265`

---

## 📊 Exploration Stats

| Metric | Value |
|--------|-------|
| Files Analyzed | 15+ |
| Code Paths Traced | 4 major flows |
| Bugs Confirmed | 4 |
| High Confidence (8+/10) | 4 |
| Test Scripts Created | 3 |
| Estimated Fix Time | 5.5 hours |

---

## ✅ Validation Checklist

- [ ] Run `node validate-bugs.js` and confirm all 4 bugs
- [ ] Read `BUG_SUMMARY.md` for context
- [ ] Review `BUG_REPORT.md` for Bug #1 and #2 (highest priority)
- [ ] Execute reproduction commands from `RUN_COMMANDS.md`
- [ ] Plan implementation order (Bug #1 → #2 → #3 → #4)
- [ ] Implement fixes with regression tests
- [ ] Verify fixes with validation commands
- [ ] Consider adding integration tests for reconnect scenarios

---

## 🎯 What's Next?

### Recommended Action Flow

**Week 1: Assessment & Planning**
1. Review all 4 bugs in BUG_REPORT.md (2–3 hours)
2. Run validation commands to confirm in staging (1 hour)
3. Triage by severity and impact (30 min)
4. Estimate team capacity and allocate resources

**Week 2–3: Implementation**
1. Fix Bug #1 (Session ID mismatch) — 1 hour
2. Fix Bug #2 (Metadata persistence) — 2 hours
3. Add regression tests for both — 1.5 hours
4. Fix Bug #3 (Timestamp format) — 1 hour
5. Fix Bug #4 (Cleanup pattern) — 1.5 hours
6. Add integration tests — 1 hour
7. Full test suite verification — 1 hour

**Week 4: Verification & Deployment**
1. User acceptance testing of session recovery
2. Monitor production session behavior
3. Validate no resource leaks under load
4. Document changes in CHANGELOG

---

## 📌 Important Notes

- ✅ **No files modified:** This exploration only reads and documents; no production changes made
- ✅ **Reproducible:** All bugs can be validated with provided scripts
- ✅ **High confidence:** All findings are 8+/10 confidence with clear root causes
- ✅ **Actionable:** Each bug includes specific file/line references and suggested fixes
- ⚠️ **Assumptions:** Some findings assume thin client behavior patterns inferred from code; confirm with telemetry
- ⚠️ **Latent issues:** Bug #2 is latent—doesn't fail immediately, only after rehydration

---

## 💬 Questions?

Each bug has:
- ✅ Root cause explanation
- ✅ Concrete reproduction scenario
- ✅ Code snippets showing the problem
- ✅ Suggested fix with implementation notes
- ✅ Verification commands

Refer to **BUG_REPORT.md** for detailed answers to "why" and "how to fix" for each bug.

---

**Created:** January 2025  
**Repository:** jsilvanus/live-captions-yt  
**Status:** ✅ Complete — Ready for review and implementation  
