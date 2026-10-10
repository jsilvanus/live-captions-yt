# Run Commands for Bug Validation and Testing

This document provides commands to reproduce, test, and validate the 4 bugs found in the live-captions-yt codebase.

---

## Bug #1: Session ID Mismatch on Reconnect After Server Rehydration

### Quick Verification (No Setup Required)
Verify the hash collision issue that causes the bug:

```bash
node -e "
const {createHash} = require('crypto');
function makeSessionId(apiKey, streamKey, domain) {
  return createHash('sha256').update(\`\${apiKey}:\${streamKey}:\${domain}\`).digest('hex').slice(0, 16);
}
console.log('=== Session ID Hash Collision ===');
const original = makeSessionId('test-key', 'stream-key', 'https://example.com');
const reconnect = makeSessionId('test-key', '', 'https://example.com');
console.log('Original session ID (with streamKey):', original);
console.log('Reconnect session ID (empty streamKey):', reconnect);
console.log('IDs match?', original === reconnect, '(should be false - this is the bug)');
"
```

### Integration Test (Requires Backend)
Test the full session recovery flow:

```bash
# Terminal 1: Start the backend
cd packages/lcyt-backend
npm test -- --test-name-pattern="POST /live"

# This runs the live.test.js file which has tests for:
# - "should be idempotent — re-registration returns same token"
# - "reconnecting with targets omitted does NOT wipe the running session's targets"
# But these tests PASS a streamKey or targets, which masks the bug
```

### Manual Test (Full Reproduction)
To reproduce the bug end-to-end:

```bash
# 1. Start backend with test database
cd packages/lcyt-backend
ALLOWED_DOMAINS=* npm run start:backend &
BACKEND_PID=$!

# 2. Create initial session WITH streamKey
curl -X POST http://localhost:3000/live \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "test-api-key",
    "domain": "http://localhost:3000",
    "streamKey": "original-stream-key"
  }' | jq .sessionId > /tmp/session1.txt

SESSION1=$(cat /tmp/session1.txt | tr -d '"')
echo "Initial session ID: $SESSION1"

# 3. Simulate server restart (kill and restart backend)
kill $BACKEND_PID
sleep 2
ALLOWED_DOMAINS=* npm run start:backend &
BACKEND_PID=$!
sleep 2

# 4. Reconnect WITHOUT streamKey (what happens after network drop)
curl -X POST http://localhost:3000/live \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "test-api-key",
    "domain": "http://localhost:3000"
  }' | jq .sessionId > /tmp/session2.txt

SESSION2=$(cat /tmp/session2.txt | tr -d '"')
echo "Reconnect session ID: $SESSION2"

# 5. Verify they DON'T match (the bug)
if [ "$SESSION1" == "$SESSION2" ]; then
  echo "✓ Sessions match (bug FIXED)"
else
  echo "✗ Sessions differ (bug REPRODUCED)"
  echo "  Original:  $SESSION1"
  echo "  Reconnect: $SESSION2"
fi

kill $BACKEND_PID
```

---

## Bug #2: Incomplete Session Metadata Persisted in touch()

### Unit Test (Fast Verification)
```bash
cd packages/lcyt-backend
npm test -- test/store.test.js
```

Look for test: "SessionStore — nextSequence"

### Manual Verification
Check what fields are saved when touch() is called:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database(':memory:');

// Create sessions table (simplified version)
db.exec(\`
  CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    api_key TEXT,
    stream_key TEXT,
    domain TEXT,
    sequence INTEGER,
    started_at TEXT,
    last_activity TEXT,
    sync_offset INTEGER
  )
\`);

// Simulate store.create() - saves all fields
db.prepare(\`
  INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)
\`).run(
  'session1',
  'api-key-1',
  'stream-key-1',
  'https://example.com',
  0,
  '2026-02-20T12:00:00.000',
  '2026-02-20T12:00:00.000',
  0
);

console.log('After create():');
const row1 = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get('session1');
console.log('  apiKey:', row1.api_key, '(should be api-key-1)');
console.log('  streamKey:', row1.stream_key, '(should be stream-key-1)');
console.log('  domain:', row1.domain, '(should be https://example.com)');

// Simulate store.touch() - saves only some fields
db.prepare(\`
  UPDATE sessions SET
    sequence = ?,
    last_activity = ?,
    sync_offset = ?
  WHERE session_id = ?
\`).run(
  1,
  '2026-02-20T12:00:05.000',
  0,
  'session1'
);

console.log('\nAfter touch() update (bug: does NOT update apiKey, streamKey, domain):');
const row2 = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get('session1');
console.log('  apiKey:', row2.api_key, '(still api-key-1 - only because not NULLed)');
console.log('  streamKey:', row2.stream_key, '(still stream-key-1 - only because not NULLed)');

// Now if we had a bug where touch() explicitly set them to NULL...
db.prepare(\`
  UPDATE sessions SET
    api_key = NULL,
    stream_key = NULL,
    domain = NULL,
    started_at = NULL,
    sequence = ?,
    last_activity = ?,
    sync_offset = ?
  WHERE session_id = ?
\`).run(
  2,
  '2026-02-20T12:00:10.000',
  0,
  'session1'
);

console.log('\nAfter buggy touch() that NULLs fields:');
const row3 = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get('session1');
console.log('  apiKey:', row3.api_key, '(BUG: now NULL!)');
console.log('  streamKey:', row3.stream_key, '(BUG: now NULL!)');
console.log('  domain:', row3.domain, '(BUG: now NULL!)');
console.log('  startedAt:', row3.started_at, '(BUG: now NULL!)');
"
```

### Check saveSession() calls
Search for all places where saveSession is called with incomplete data:

```bash
cd packages/lcyt-backend
grep -n "saveSession(db," src/**/*.js | grep -v "apiKey"
```

This shows saveSession calls that might be missing fields.

---

## Bug #3: Inconsistent Timestamp Format for YouTube Extra Targets

### Code Inspection Verification
```bash
cd packages/lcyt-backend

# Show the inconsistency: YouTube gets e.timestamp, others get e.tsStr
echo "=== YouTube target line 79 (receives e.timestamp) ==="
sed -n '76,82p' src/caption-fanout.js

echo ""
echo "=== Generic target line 95 (receives e.tsStr) ==="
sed -n '92,100p' src/caption-fanout.js

echo ""
echo "=== Viewer target line 108 (receives e.tsStr) ==="
sed -n '105,115p' src/caption-fanout.js
```

### Test with Relative Time Offsets
Test that caption with `time` field is handled consistently:

```bash
npm test -- test/captions.test.js
```

Look for tests about timestamp resolution (tests with "time" or "relative").

### Manual Verification Script
```bash
node -e "
console.log('=== Timestamp Format Inconsistency ===\n');

// Simulate what happens in caption-fanout.js
const caption = {
  text: 'Test caption',
  timestamp: new Date('2026-02-20T12:00:00.000Z'),  // Date object from captions.js
  composedText: 'Test caption'
};

const entry = {
  ...caption,
  tsStr: caption.timestamp instanceof Date 
    ? caption.timestamp.toISOString() 
    : caption.timestamp
};

console.log('Original timestamp (from POST /captions):');
console.log('  Type:', typeof caption.timestamp);
console.log('  Value:', caption.timestamp);

console.log('\nNormalized tsStr (line 54-56):');
console.log('  Type:', typeof entry.tsStr);
console.log('  Value:', entry.tsStr);

console.log('\nYouTube target receives (line 79):');
console.log('  target.sender.send(text, e.timestamp)');
console.log('  Type:', typeof entry.timestamp);
console.log('  → Date object');

console.log('\nGeneric target receives (line 95):');
console.log('  fetch(url, { body: { captions: [{ timestamp: e.tsStr }] } })');
console.log('  Type:', typeof entry.tsStr);
console.log('  → ISO string');

console.log('\n⚠️  INCONSISTENCY: YouTube gets Date, others get string');
console.log('Fix: Use e.tsStr on line 79 instead of e.timestamp');
"
```

---

## Bug #4: Fire-and-Forget Promise Cleanup in Target Reconnection

### Pattern Detection
```bash
cd packages/lcyt-backend

echo "=== Fire-and-forget pattern in routes/live.js ==="
grep -n "Promise.resolve.*\.catch(() => {})" src/routes/live.js

echo ""
echo "=== Fire-and-forget pattern in store.js ==="
grep -n "Promise.resolve.*\.catch(() => {})" src/store.js
```

### Test Cleanup Timing
```bash
node -e "
console.log('=== Promise.resolve() Anti-Pattern ===\n');

// Show the problematic pattern
console.log('Current code:');
console.log('  Promise.resolve(t.sender.end()).catch(() => {});\n');

// Demonstrate why it's problematic
const sender = {
  end: () => Promise.reject(new Error('Connection failed'))
};

console.log('Test 1: Rejected promise');
Promise.resolve(sender.end()).catch(err => {
  console.log('  ✓ Caught via Promise.resolve().catch():', err.message);
});

console.log('\nTest 2: Same test with direct .catch() (cleaner)');
sender.end().catch(err => {
  console.log('  ✓ Caught via direct .catch():', err.message);
});

console.log('\nBetter patterns:');
console.log('1. Synchronous cleanup (if .end() is sync):');
console.log('   try { t.sender.end(); } catch (e) {}');
console.log('');
console.log('2. Async with await:');
console.log('   await t.sender.end().catch(() => {})');
console.log('');
console.log('3. Fire-and-forget with direct catch:');
console.log('   t.sender.end().catch(() => {})');
"
```

### Verify sender.end() Behavior
Check if sender.end() is actually async:

```bash
cd packages/lcyt
grep -A 5 "end()" src/sender.js | head -20
```

---

## Running All Tests

### Run Backend Tests
```bash
cd packages/lcyt-backend
npm test 2>&1 | tee test-results.txt
```

### Run Live Endpoint Tests Specifically
```bash
cd packages/lcyt-backend
npm test -- test/live.test.js 2>&1 | tee live-test-results.txt
```

### Run Store Tests Specifically
```bash
cd packages/lcyt-backend
npm test -- test/store.test.js 2>&1 | tee store-test-results.txt
```

### Run Caption Tests Specifically
```bash
cd packages/lcyt-backend
npm test -- test/captions.test.js 2>&1 | tee captions-test-results.txt
```

---

## Validation Checklist

After fixes are applied, run these commands to verify:

```bash
# 1. Verify Bug #1 is fixed: Session IDs should match after reconnect
npm test -- test/live.test.js --grep "idempotent"

# 2. Verify Bug #3 is fixed: Run caption fanout tests
npm test -- test/caption-fanout.test.js

# 3. Verify Bug #4 is fixed: No fire-and-forget patterns
npm test -- test/live.test.js --grep "targets"

# 4. Run full test suite
npm test

# 5. Check for TypeScript/linting errors (if applicable)
npm run lint
```

---

## Reproduction Environment Setup

```bash
# Full backend setup for manual testing
cd packages/lcyt-backend

# Install dependencies
npm install

# Start test database (uses :memory:)
ALLOWED_DOMAINS=* npm run start:backend

# In another terminal, run tests while server is running
npm test -- test/live.test.js
```

---

## Summary

| Bug | Quick Test | Full Test | Manual Repro |
|-----|-----------|-----------|--------------|
| #1: Session ID mismatch | `node -e "..."` hash test | `npm test -- test/live.test.js` | Restart backend, reconnect without streamKey |
| #2: Incomplete metadata | `npm test -- test/store.test.js` | Check saveSession() calls | Query database directly |
| #3: Timestamp inconsistency | `node -e "..."` format check | `npm test -- test/captions.test.js` | Review caption-fanout.js lines 79 vs 95 |
| #4: Fire-and-forget cleanup | `grep "Promise.resolve"` pattern | `npm test` full suite | Check cleanup timing with delay injection |

