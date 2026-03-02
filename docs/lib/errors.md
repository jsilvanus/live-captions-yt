# Error Classes

`lcyt` uses a typed error hierarchy so callers can handle errors at different levels of specificity. All errors extend the base `LCYTError` class.

**Import**
```js
import { LCYTError, ConfigError, NetworkError, ValidationError } from 'lcyt/errors';
// CJS
const { LCYTError, ConfigError, NetworkError, ValidationError } = require('lcyt/errors');
```

---

## Hierarchy

```
Error
└── LCYTError
    ├── ConfigError
    ├── NetworkError  (+ statusCode)
    └── ValidationError  (+ field)
```

---

## `LCYTError`

Base class for all `lcyt` errors. Catch this to handle any library error.

```js
try {
  await sender.send('text');
} catch (err) {
  if (err instanceof LCYTError) {
    console.error('lcyt error:', err.message);
  }
}
```

| Property | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable error description |
| `name` | `string` | `'LCYTError'` |

---

## `ConfigError`

Thrown when a configuration file cannot be read, parsed, or written.

```js
import { ConfigError } from 'lcyt/errors';
import { loadConfig } from 'lcyt/config';

try {
  const config = loadConfig('/bad/path.json');
} catch (err) {
  if (err instanceof ConfigError) {
    console.error('Config problem:', err.message);
  }
}
```

| Property | Type | Description |
|---|---|---|
| `name` | `string` | `'ConfigError'` |

---

## `NetworkError`

Thrown when an HTTP request to YouTube (or the relay backend) fails, either due to a transport error or a non-2xx status code.

```js
import { NetworkError } from 'lcyt/errors';

try {
  await sender.send('Hello!');
} catch (err) {
  if (err instanceof NetworkError) {
    console.error(`HTTP ${err.statusCode}: ${err.message}`);
  }
}
```

| Property | Type | Description |
|---|---|---|
| `name` | `string` | `'NetworkError'` |
| `statusCode` | `number \| undefined` | HTTP status code (e.g. `403`, `503`). `undefined` for transport-level failures (e.g. ECONNREFUSED). |

---

## `ValidationError`

Thrown when input values fail validation before a request is made.

```js
import { ValidationError } from 'lcyt/errors';

try {
  await sender.send(''); // empty caption
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(`Invalid field "${err.field}": ${err.message}`);
  }
}
```

| Property | Type | Description |
|---|---|---|
| `name` | `string` | `'ValidationError'` |
| `field` | `string` | Name of the field that failed validation (e.g. `'text'`, `'streamKey'`) |

---

## Catching All Errors

```js
import { LCYTError, NetworkError, ValidationError, ConfigError } from 'lcyt/errors';

try {
  await sender.send(text);
} catch (err) {
  if (err instanceof ValidationError) {
    // Input problem — fix the request
    console.error(`Bad input for field "${err.field}"`);
  } else if (err instanceof NetworkError) {
    // HTTP/transport problem — may be transient
    console.error(`Network error (${err.statusCode ?? 'no status'}):`, err.message);
  } else if (err instanceof ConfigError) {
    // Config problem — check ~/.lcyt-config.json
    console.error('Configuration error:', err.message);
  } else if (err instanceof LCYTError) {
    // Unknown lcyt error
    console.error('lcyt error:', err.message);
  } else {
    throw err; // unexpected error — rethrow
  }
}
```
