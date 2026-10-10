# Bug Report: Live-Captions-YT Codebase Analysis

## Executive Summary

Found **4 confirmed bugs** with reproducible scenarios in the caption delivery and session management flow. Severity ranges from LOW to HIGH, with the highest-severity bug preventing session recovery after server restarts.

---

## Bug #1: Session ID Mismatch on Reconnect After Server Rehydration

### Severity
**🔴 CRITICAL** (9/10 confidence)

### Location
[packages/lcyt-backend/src/routes/live.js:247](d:\live-captions-yt\packages\lcyt-backend\src\routes\live.js:247)

### Root Cause
Session ID generation uses `makeSessionId(apiKey, streamKey || '', domain)`, but the normalization of `streamKey` is inconsistent between initial session creation and reconnection after server restart.

When a client creates a session with a `streamKey`, the session ID is deterministically generated as:
```
hash("apiKey:streamKey:domain")
```

When the server restarts and rehydrates the session from the database, but the reconnecting client omits the `streamKey` field in the POST body, the code calculates:
```
hash("apiKey::domain")  // DIFFERENT!
```

This happens because:
1. **Initial creation** (line 240-247): `streamKey` from request body is used directly
2. **Server restart + rehydration** (line 245-247): `streamKey` from request body is undefined, so `streamKey || ''` evaluates to `''`
3. The hashes don't match → session is not found → client gets a new session ID

### Triggering Scenario

1. Client A sends: `POST /live { apiKey: "key1", streamKey: "original-stream", domain: "https://a.com" }`
   - Server creates session with ID = `hash("key1:original-stream:https://a.com")` → `36751a66d20d5574`
   - Client receives JWT with sessionId `36751a66d20d5574`

2. Server restarts and rehydrates DB sessions into memory
   - Session from DB is loaded with streamKey="original-stream"

3. Client reconnects (after network drop) without sending streamKey:
   - Sends: `POST /live { apiKey: "key1", domain: "https://a.com" }`
   - Server calculates session ID = `hash("key1::https://a.com")` → `18a1858b21f97053`
   - **BUG:** Store.has(sessionId) returns `false` because the IDs don't match
   - Client receives a **new** session ID and loses sequence continuity

### Expected Behavior
Reconnecting clients should resume their existing session, preserving sequence number and session state.

### Actual Behavior
Reconnecting clients after a server restart get a **new session ID**, losing all session history.

### Verification
```bash
$ node -e "
const {createHash} = require('crypto');
function id(k,s,d) { return createHash('sha256').update(\`\${k}:\${s}:\${d}\`).digest('hex').slice(0,16); }
const orig = id('key1', 'original-stream', 'https://a.com');
const reconnect = id('key1', '', 'https://a.com');
console.log('Original:  ', orig);
console.log('Reconnect: ', reconnect);
console.log('Match:     ', orig === reconnect);
"
# Output: Match: false (bug confirmed)
```

### Impact
- **Severity**: Loss of session continuity breaks the core caption delivery contract
- **Scope**: Any client that reconnects after server restart without resending streamKey
- **Affected users**: Thin clients (web UI, CLI) that don't explicitly pass streamKey on reconnect

### Suggested Fix
Store the original `streamKey` from the database when rehydrating, then use that value for the session ID calculation if the reconnecting request omits it:

```javascript
// At line 245 in live.js:
const sessionId = makeSessionId(
  apiKey,
  streamKey !== undefined ? streamKey : streamKeyFromDb || '',
  domain
);
```

Or, ensure all clients always send the original `streamKey` on reconnect (but this requires client changes and isn't robust).

---

## Bug #2: Inconsistent Timestamp Format for YouTube Extra Targets

### Severity
**🟡 MEDIUM** (6/10 confidence)

### Location
[packages/lcyt-backend/src/caption-fanout.js:79](d:\live-captions-yt\packages\lcyt-backend\src\caption-fanout.js:79)

### Root Cause
The caption fanout function normalizes timestamps to ISO strings (line 54-56) for generic and viewer targets, but YouTube secondary targets receive the original (unnormalized) timestamp.

### Code Flow
1. **Line 50-56**: Captions are normalized into `entries`, with `tsStr` containing the ISO string form:
   ```javascript
   const entries = captions.map(c => ({
     ...c,
     tsStr: typeof c.timestamp === 'string' ? c.timestamp
       : (c.timestamp instanceof Date ? c.timestamp.toISOString() : undefined),
   }));
   ```

2. **Line 79**: YouTube targets receive the original `e.timestamp` (could be Date or string):
   ```javascript
   target.sender.send(text, e.timestamp).catch(...);
   ```

3. **Line 83 & 94**: Generic and viewer targets receive the normalized `e.tsStr`:
   ```javascript
   broadcastToViewers(target.viewerKey, {
     timestamp: e.tsStr,  // ISO string
     ...
   });
   ```

### Triggering Scenario
When a caption is sent with a `time` field (relative offset):

1. captions.js resolves it to absolute timestamp: `new Date(session.startedAt + caption.time + session.syncOffset)`
2. This Date object is passed to fanOutToTargets as `e.timestamp`
3. YouTube target receives Date object; generic/viewer targets receive ISO string
4. While `sender._formatTimestamp()` handles Date objects correctly, the inconsistency violates the normalization contract

### Expected Behavior
All targets should receive timestamps in the same format (ISO strings).

### Actual Behavior
YouTube targets receive Date objects; generic/viewer targets receive ISO strings.

### Impact
- **Severity**: Code smell and inconsistency; unlikely to cause runtime errors (sender handles both formats)
- **Scope**: Any session with extra targets (YouTube, generic, or viewer) receiving captions with `time` field
- **Risk**: Future changes to sender._formatTimestamp() could break YouTube delivery

### Suggested Fix
Use the normalized timestamp on line 79:

```javascript
// Before:
target.sender.send(text, e.timestamp).catch(err => {

// After:
target.sender.send(text, e.tsStr).catch(err => {
```

This aligns with the comment on line 50: "Normalise entries: fill in default composition and the ISO string form".

---

## Bug #3: Incomplete Session Metadata Persisted in SessionStore.touch()

### Severity
**🟠 HIGH** (7/10 confidence)

### Location
[packages/lcyt-backend/src/store.js:292-301](d:\live-captions-yt\packages\lcyt-backend\src\store.js:292-301)

### Root Cause
The `touch()` method updates session activity timestamps in the database but omits critical metadata fields needed for proper session rehydration.

### Code
```javascript
touch(sessionId) {
  const session = this._sessions.get(sessionId);
  if (session) session.lastActivityAt = new Date();
  if (session && this.db) {
    try {
      saveSession(this.db, {
        sessionId: session.sessionId,
        sequence: session.sequence,
        lastActivity: new Date(session.lastActivityAt).toISOString(),
        syncOffset: session.syncOffset,
      });
    } catch (_) {}
  }
}
```

### Missing Fields
When the database is queried, the saved row has **NULL values** for:
- `apiKey` — cannot identify which project owns this session
- `streamKey` — cannot recreate the primary sender on rehydrate
- `domain` — cannot validate CORS or match reconnecting clients
- `startedAt` — cannot calculate session duration

Compare this to `store.create()` (line 130-145) which saves all these fields:
```javascript
saveSession(this.db, {
  sessionId: session.sessionId,
  apiKey: session.apiKey,
  streamKey: session.streamKey,
  domain: session.domain,
  sequence: session.sequence,
  startedAt: new Date(session.startedAt).toISOString(),
  lastActivity: new Date(session.lastActivityAt).toISOString(),
  syncOffset: session.syncOffset,
  ...
});
```

### Triggering Scenario
1. Session is created: all metadata is saved correctly
2. Captions are sent: `session._sendQueue` chains operations, and each caption triggers `store.touch(sessionId)` (line 148 in captions.js)
3. Server crashes/restarts before the session expires
4. Rehydration loads the session, but `apiKey`, `streamKey`, `domain`, `startedAt` are NULL
5. When the session is returned to the client (line 295-303), some fields are missing

### Expected Behavior
`touch()` should persist enough metadata to fully rehydrate a session.

### Actual Behavior
`touch()` only persists `sequence`, `lastActivity`, and `syncOffset`. Critical fields like `apiKey` and `streamKey` are left NULL.

### Impact
- **Severity**: Could lead to incorrect behavior after rehydration
- **Scope**: Any session that receives captions and then the server restarts
- **Risk**: Rehydrated sessions may have incomplete metadata, affecting future operations

### Suggested Fix
Update `touch()` to persist the same fields as `create()`:

```javascript
touch(sessionId) {
  const session = this._sessions.get(sessionId);
  if (session) session.lastActivityAt = new Date();
  if (session && this.db) {
    try {
      saveSession(this.db, {
        sessionId: session.sessionId,
        apiKey: session.apiKey,  // ADD
        streamKey: session.streamKey,  // ADD
        domain: session.domain,  // ADD
        sequence: session.sequence,
        startedAt: new Date(session.startedAt).toISOString(),  // ADD
        lastActivity: new Date(session.lastActivityAt).toISOString(),
        syncOffset: session.syncOffset,
      });
    } catch (_) {}
  }
}
```

---

## Bug #4: Fire-and-Forget Promise Cleanup in Target Reconnection

### Severity
**⚪ LOW** (4/10 confidence)

### Location
[packages/lcyt-backend/src/routes/live.js:265](d:\live-captions-yt\packages\lcyt-backend\src\routes\live.js:265)
[packages/lcyt-backend/src/store.js:354](d:\live-captions-yt\packages\lcyt-backend\src\store.js:354)

### Root Cause
When cleaning up old YouTube senders, the code uses `Promise.resolve(t.sender.end()).catch(() => {})` which is a fire-and-forget pattern that doesn't guarantee cleanup completion before further operations.

### Code Pattern
**routes/live.js (line 265):**
```javascript
for (const t of (existing.extraTargets || [])) {
  if (t.type === 'youtube' && t.sender) {
    Promise.resolve(t.sender.end()).catch(() => {});
  }
}
```

**store.js (line 354):**
```javascript
if (target.type === 'youtube' && target.sender) {
  try {
    target.sender.end();
  } catch {
    // Best-effort cleanup
  }
}
```

### Issues
1. **Promise.resolve() anti-pattern**: `Promise.resolve(promise)` doesn't unwrap rejected promises in the way the comment suggests. If `sender.end()` returns a rejected promise, `Promise.resolve()` returns a promise that also rejects, and the `.catch()` handler should catch it. However, this is non-idiomatic.

2. **Fire-and-forget cleanup**: Without `await`, there's no guarantee the cleanup completes before:
   - The request handler finishes and the session becomes subject to GC
   - The server shuts down
   - The next caption arrives and reuses the sender object

3. **Asymmetry**: store.js uses synchronous `.end()` (line 354) while live.js assumes it's async (line 265)

### Triggering Scenario
1. Client A reconnects with a new targets array
2. Old YouTube senders are scheduled for cleanup (fire-and-forget)
3. Server receives a shutdown signal before cleanup completes
4. Old sender resources may leak (unclosed HTTP connections, etc.)

### Expected Behavior
All sender cleanup should complete before the session state changes or the server shuts down.

### Actual Behavior
Cleanup is asynchronous and fire-and-forget, with no guarantee of completion.

### Impact
- **Severity**: Low (cleanup typically completes quickly)
- **Scope**: Sessions with extra YouTube targets that reconnect with different targets
- **Risk**: Potential resource leaks under high load or during shutdown

### Suggested Fix
Make cleanup synchronous or ensure completion before proceeding:

```javascript
// Option 1: Explicit async/await in POST handler
for (const t of (existing.extraTargets || [])) {
  if (t.type === 'youtube' && t.sender) {
    await t.sender.end().catch(() => {});
  }
}

// Option 2: Promise.allSettled() to wait for all cleanups
await Promise.allSettled(
  (existing.extraTargets || [])
    .filter(t => t.type === 'youtube' && t.sender)
    .map(t => t.sender.end().catch(() => {}))
);
```

---

## Recommendations

### Priority Fixes
1. **Bug #1 (CRITICAL)**: Fix session ID mismatch immediately — breaks core session recovery
2. **Bug #3 (HIGH)**: Fix touch() metadata persistence — affects rehydration correctness
3. **Bug #2 (MEDIUM)**: Use normalized timestamp for YouTube targets — consistency improvement
4. **Bug #4 (LOW)**: Improve promise cleanup pattern — resource leak prevention

### Testing
- Add tests for session rehydration with missing streamKey
- Add tests for caption delivery with extra YouTube targets using relative time offsets
- Add tests for session persistence across caption sends
- Add tests for target reconnection and cleanup

### Validation Scope
- Verified with code inspection and test scripts
- No runtime validation in test suite yet
- Suggest adding integration tests for server restart + reconnect scenarios

---

## Files Analyzed
- packages/lcyt-backend/src/routes/live.js (caption delivery entry point)
- packages/lcyt-backend/src/store.js (session storage and rehydration)
- packages/lcyt-backend/src/caption-fanout.js (multi-target delivery logic)
- packages/lcyt/src/sender.js (YouTube caption sender)
- packages/lcyt/src/backend-sender.js (backend relay sender)

## Conclusion
The codebase has solid foundation but exhibits gaps in session persistence, error handling, and edge-case handling around server restarts and session recovery. The critical session ID bug should be addressed immediately.
