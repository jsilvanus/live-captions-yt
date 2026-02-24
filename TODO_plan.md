# Plan: Implement TODO.md items

## Context

Implementing all open items from `TODO.md`:
- Python lcyt package lacks the stderr-routing feature that the Node.js package has (`setUseStderr`)
- The MCP `get_status` tool has a stale description and doesn't auto-sync on call
- The MCP `send_caption` / `send_batch` tools don't expose a `time` (ms offset) field
- Root-level `plan_*` / `todo_*` docs are loose and should live in `docs/`
- `CLAUDE.md` is missing `lcyt-mcp` from the package list

---

## 1. Python `set_use_stderr` — new `logger.py`

**New file:** `python-packages/lcyt/lcyt/logger.py`

```python
import logging, sys

_logger = logging.getLogger("lcyt")
_handler: logging.StreamHandler | None = None

def set_use_stderr(value: bool) -> None:
    """Route lcyt log output to stderr (for MCP/pipeline compatibility)."""
    global _handler
    if _handler is not None:
        _logger.removeHandler(_handler)
        _handler = None
    if value:
        _handler = logging.StreamHandler(sys.stderr)
        _handler.setFormatter(logging.Formatter("[LCYT] %(message)s"))
        _logger.addHandler(_handler)
        _logger.propagate = False
        if _logger.level == logging.NOTSET:
            _logger.setLevel(logging.DEBUG)
    else:
        _logger.propagate = True

def set_silent(value: bool) -> None:
    """Suppress all lcyt log output."""
    _logger.setLevel(logging.CRITICAL + 1 if value else logging.DEBUG)
```

**Edit:** `python-packages/lcyt/lcyt/__init__.py`
- Add `from .logger import set_use_stderr, set_silent`
- Add both to `__all__`

---

## 2. MCP `get_status` — auto-sync + updated description

**File:** `packages/lcyt-mcp/src/server.js`

**Description update** (line 88):
```
"Sync the clock then return the current sequence number, syncOffset, and roundTripTime. Runs a heartbeat automatically — no need to call sync_clock separately."
```

**Handler update** (lines 198–208) — call `sender.sync()` first, include `roundTripTime` in response:
```javascript
case "get_status": {
  const sender = getSession(args.session_id);
  const syncResult = await sender.sync();
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        sequence: sender.sequence,
        syncOffset: syncResult.syncOffset,
        roundTripTime: syncResult.roundTripTime,
      }),
    }],
  };
}
```

**Test file:** `packages/lcyt-mcp/test/server.test.js`
- Update `FakeSender.sync()` to also set `this.syncOffset = 42` so it mirrors the real sender
- Update the `get_status` test to assert `payload.syncOffset === 42` and `"roundTripTime" in payload`
- Update the full lifecycle test (which calls `get_status`) — no assertion change needed since it only checks `sequence`

---

## 3. MCP `time` field (ms offset from now + sync)

**File:** `packages/lcyt-mcp/src/server.js`

### Schema additions

`send_caption` — add optional `time` property:
```javascript
time: {
  type: "number",
  description: "ms offset from current time (negative = past). Applied with syncOffset. Alternative to timestamp.",
},
```

`send_batch` items — add optional `time` property:
```javascript
time: {
  type: "number",
  description: "ms offset from current time. Alternative to timestamp.",
},
```
Update `send_batch` description to: `"Send multiple captions atomically. Each item takes {text, timestamp?} or {text, time?} (ms offset)."`.

### Helper (add above switch statement)
```javascript
function resolveTimestamp(tsArg, timeArg, syncOffset) {
  if (tsArg !== undefined) return tsArg;
  if (timeArg !== undefined) return new Date(Date.now() + (syncOffset ?? 0) + timeArg).toISOString();
  return undefined;
}
```

### Handler updates

`send_caption`:
```javascript
case "send_caption": {
  const sender = getSession(args.session_id);
  const ts = resolveTimestamp(args.timestamp, args.time, sender.syncOffset);
  const result = await sender.send(args.text, ts);
  ...
}
```

`send_batch`:
```javascript
case "send_batch": {
  const sender = getSession(args.session_id);
  const captions = args.captions.map(c => ({
    text: c.text,
    timestamp: resolveTimestamp(c.timestamp, c.time, sender.syncOffset),
  }));
  const result = await sender.sendBatch(captions);
  ...
}
```

**Test file:** Add test for `send_caption` with `time` field (e.g. `time: -1000`), assert `ok: true`.

---

## 4. Move `plan_*` / `todo_*` to `docs/`

Create `docs/` directory by moving these files:
- `plan.md` → `docs/plan.md`
- `plan_backend.md` → `docs/plan_backend.md`
- `plan_client.md` → `docs/plan_client.md`
- `plan_mcp.md` → `docs/plan_mcp.md`
- `todo_backend.md` → `docs/todo_backend.md`
- `todo_client.md` → `docs/todo_client.md`

(`TODO.md` at root stays — it's the active task list used by the project.)

---

## 5. Update `CLAUDE.md`

Add `packages/lcyt-mcp/` to the Node.js packages section:
```
- `packages/lcyt-mcp/` — MCP server (published to npm as `lcyt-mcp`)
  - `src/server.js` — MCP tool definitions and handlers
```

Add a `docs/` entry under Key Files / project structure:
```
- `docs/` — planning docs (plan_*.md, todo_*.md)
```

---

## Verification

1. **Python stderr test** — In a Python REPL:
   ```python
   from lcyt import set_use_stderr
   from lcyt import YoutubeLiveCaptionSender
   set_use_stderr(True)
   s = YoutubeLiveCaptionSender(stream_key="test", verbose=True)
   # All [LCYT] logs should appear on stderr
   ```
2. **MCP tests** — `npm test` from repo root; existing + new tests all pass.
3. **Docs move** — `ls docs/` shows all 6 files; none remain at root.
4. **CLAUDE.md** — Quick review confirms lcyt-mcp is listed.
