---
id: lib/python/errors
title: "Python — Error Classes"
---

# Error Classes (Python)

`lcyt` uses a typed exception hierarchy so callers can handle errors at different levels of specificity. All exceptions extend the base `LCYTError` class.

**Import**
```python
from lcyt.errors import LCYTError, ConfigError, NetworkError, ValidationError
```

---

## Hierarchy

```
Exception
└── LCYTError
    ├── ConfigError
    ├── NetworkError  (+ status_code)
    └── ValidationError  (+ field)
```

---

## `LCYTError`

Base class for all `lcyt` exceptions. Catch this to handle any library error.

```python
from lcyt.errors import LCYTError

try:
    result = sender.send("text")
except LCYTError as e:
    print("lcyt error:", e)
```

---

## `ConfigError`

Raised when a configuration file cannot be read, parsed, or written.

```python
from lcyt.errors import ConfigError
from lcyt.config import load_config

try:
    config = load_config("/bad/path.json")
except ConfigError as e:
    print("Config problem:", e)
```

---

## `NetworkError`

Raised when an HTTP request to YouTube (or the relay backend) fails, either due to a transport error or a non-2xx status code.

```python
from lcyt.errors import NetworkError

try:
    result = sender.send("Hello!")
except NetworkError as e:
    print(f"HTTP {e.status_code}: {e}")
```

| Attribute | Type | Description |
|---|---|---|
| `status_code` | `int \| None` | HTTP status code (e.g. `403`, `503`). `None` for transport-level failures. |

---

## `ValidationError`

Raised when input values fail validation before a request is made.

```python
from lcyt.errors import ValidationError

try:
    sender.send("")  # empty text
except ValidationError as e:
    print(f"Invalid field '{e.field}': {e}")
```

| Attribute | Type | Description |
|---|---|---|
| `field` | `str \| None` | Name of the field that failed validation (e.g. `'text'`, `'stream_key'`) |

---

## Catching All Errors

```python
from lcyt.errors import LCYTError, NetworkError, ValidationError, ConfigError

try:
    result = sender.send(text)
except ValidationError as e:
    # Input problem — fix the request
    print(f"Bad input for field '{e.field}'")
except NetworkError as e:
    # HTTP/transport problem — may be transient
    print(f"Network error ({e.status_code}): {e}")
except ConfigError as e:
    # Config problem — check ~/.lcyt-config.json
    print("Configuration error:", e)
except LCYTError as e:
    # Unknown lcyt error
    print("lcyt error:", e)
```
