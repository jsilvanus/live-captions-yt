# Plan: YouTube Heartbeat Sync (syncOffset)

## Summary

Add an NTP-style clock synchronization mechanism to `YoutubeLiveCaptionSender` using the heartbeat's server timestamp. A new `sync()` method computes a `syncOffset` (ms) between local clock and YouTube's server clock. When `useSyncOffset` is enabled, all auto-generated timestamps are adjusted by this offset.

## Changes

### 1. `packages/lcyt/src/sender.js` — Core sync logic

**Constructor (`options`):**
- Add `this.syncOffset = 0` — clock offset in ms (positive = server ahead)
- Add `this.useSyncOffset = options.useSyncOffset || false` — gate for applying the offset

**New internal helper `_now()`:**
- Returns `Date.now() + (this.useSyncOffset ? this.syncOffset : 0)`
- Used everywhere "current time" is needed (replaces raw `Date.now()` / `new Date()`)

**Apply `_now()` in four places:**
1. `_formatTimestamp(undefined)` — line 82: `new Date()` → `new Date(this._now())`
2. `_formatTimestamp(relativeSeconds)` — line 75: `Date.now()` → `this._now()`
3. `sendBatch()` auto-timestamp — line 335: `new Date()` → `new Date(this._now())`
4. `sendTest()` — line 460: `new Date()` → `new Date(this._now())`

**New method `async sync()`:**
```js
async sync() {
  const t1 = Date.now();
  const result = await this.heartbeat();
  const t2 = Date.now();

  if (!result.serverTimestamp) {
    return { syncOffset: 0, roundTripTime: t2 - t1, serverTimestamp: null, statusCode: result.statusCode };
  }

  // Parse server timestamp (format: YYYY-MM-DDTHH:MM:SS.mmm — no Z, treat as UTC)
  const serverTime = new Date(result.serverTimestamp + 'Z').getTime();
  const localEstimate = (t1 + t2) / 2;
  this.syncOffset = Math.round(serverTime - localEstimate);
  this.useSyncOffset = true;

  return {
    syncOffset: this.syncOffset,
    roundTripTime: t2 - t1,
    serverTimestamp: result.serverTimestamp,
    statusCode: result.statusCode
  };
}
```

**New methods:**
- `getSyncOffset()` — returns `this.syncOffset`
- `setSyncOffset(offset)` — sets `this.syncOffset`, returns `this` for chaining

### 2. `packages/lcyt-cli/bin/lcyt` — CLI integration

**After `sender.start()` in these flows, call `await sender.sync()`:**
- `sendHeartbeat()` — after heartbeat, also display sync offset
- `runFullscreenMode()` path (both npx default and `--fullscreen`)
- `runInteractiveMode()` path
- `sendSingleCaption()` path
- `isSend` (batch send) path
- Setup wizard heartbeat test

For all these: wrap `sync()` in try/catch so sync failure doesn't block the primary action (just log a warning).

**`--reset` path (line 160-164):** After resetting sequence, the next `sender.start()` + `sender.sync()` flow handles it naturally since the sender is freshly created.

### 3. `packages/lcyt-cli/src/interactive-ui.js` — UI integration

**Add `/sync` command:**
- Calls `await this.sender.sync()`
- Logs the offset and round-trip time

**Update `/heartbeat` command:**
- Also display current `syncOffset` if non-zero

**Update help text:**
- Add `/sync` to the commands list

### 4. `packages/lcyt/test/sender.test.js` — Tests

**New test group `sync / syncOffset`:**
- `_now()` returns `Date.now()` when `useSyncOffset` is false
- `_now()` returns `Date.now() + syncOffset` when `useSyncOffset` is true
- `getSyncOffset()` / `setSyncOffset()` work correctly
- `_formatTimestamp(undefined)` uses syncOffset when enabled
- `_formatTimestamp(relativeSeconds)` uses syncOffset when enabled
- Constructor accepts `useSyncOffset` option

## Files touched

1. `packages/lcyt/src/sender.js` — core changes
2. `packages/lcyt-cli/bin/lcyt` — CLI sync-on-startup
3. `packages/lcyt-cli/src/interactive-ui.js` — `/sync` command + help
4. `packages/lcyt/test/sender.test.js` — new tests

## Not changed

- `heartbeat()` method itself — unchanged, `sync()` wraps it
- Explicit user-provided timestamps (Date objects, epoch ms, ISO strings) — untouched
- Sequence number logic — unrelated
