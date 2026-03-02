# Logger

A pluggable, structured logger used throughout `lcyt`. All log output is prefixed with `[LCYT]`.

**Import**
```js
import logger from 'lcyt/logger';
// CJS
const logger = require('lcyt/logger').default;
```

The module exports a **global singleton** instance — all modules in the same process share the same logger state.

---

## Log Methods

All methods accept a message string and any number of additional arguments (passed to the underlying output function).

```js
logger.info('Starting sender...');
logger.success('Caption sent (seq 42)');
logger.warn('Stream key not set');
logger.error('Connection failed', err);
logger.debug('Raw response:', response);
```

| Method | Level | When logged |
|---|---|---|
| `info(msg, ...args)` | INFO | Always (unless `silent`) |
| `success(msg, ...args)` | SUCCESS | Always (unless `silent`) |
| `warn(msg, ...args)` | WARN | Always (unless `silent`) |
| `error(msg, ...args)` | ERROR | Always (unless `silent`) |
| `debug(msg, ...args)` | DEBUG | Only when `verbose` is `true` |

---

## Configuration Methods

### `setVerbose(enabled)`

Enable or disable debug-level logging.

```js
logger.setVerbose(true);
logger.debug('This will now appear');
```

| Parameter | Type | Description |
|---|---|---|
| `enabled` | `boolean` | `true` to enable debug output |

---

### `setSilent(enabled)`

Suppress all log output (useful for library consumers who handle output themselves).

```js
logger.setSilent(true);
```

| Parameter | Type | Description |
|---|---|---|
| `enabled` | `boolean` | `true` to suppress all output |

---

### `setUseStderr(enabled)`

Route all log output to `stderr` instead of `stdout`.

```js
logger.setUseStderr(true);
```

> **MCP servers** must set this to `true` (or set `LCYT_LOG_STDERR=1`) because the MCP protocol uses `stdout` for its own messages. Writing logs to `stdout` will corrupt the MCP stream.

| Parameter | Type | Description |
|---|---|---|
| `enabled` | `boolean` | `true` to write to `stderr` |

---

### `setCallback(fn)`

Register a callback that receives every log event. Useful for piping logs into a UI or file.

```js
logger.setCallback((level, message, ...args) => {
  myLogStore.push({ level, message, extra: args });
});
```

| Parameter | Type | Description |
|---|---|---|
| `fn` | `(level: string, message: string, ...args: any[]) => void` | Callback invoked for every log call. Pass `null` to remove. |

---

## Environment Variable

| Variable | Effect |
|---|---|
| `LCYT_LOG_STDERR=1` | Equivalent to calling `logger.setUseStderr(true)` at startup |

Set this in the environment when running as an MCP server subprocess to avoid corrupting the stdio transport.

---

## Example: Redirecting Logs to a File

```js
import logger from 'lcyt/logger';
import fs from 'node:fs';

const logFile = fs.createWriteStream('./lcyt.log', { flags: 'a' });

logger.setCallback((level, message) => {
  logFile.write(`[${new Date().toISOString()}] [${level}] ${message}\n`);
});

logger.setSilent(true); // suppress stdout output
```

## Example: Verbose Mode for Development

```js
import logger from 'lcyt/logger';

logger.setVerbose(true);
logger.debug('This shows detailed internals'); // now visible
```
