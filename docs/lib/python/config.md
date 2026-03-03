---
id: lib/python/config
title: "Python — Configuration"
---

# Configuration (Python)

Utilities for loading, saving, and building YouTube ingestion URLs from the `lcyt` configuration file (`~/.lcyt-config.json`).

**Import**
```python
from lcyt.config import (
    LCYTConfig,
    load_config,
    save_config,
    build_ingestion_url,
    get_default_config_path,
)
```

---

## Config File

By default, configuration is stored at `~/.lcyt-config.json`. The file is plain JSON:

```json
{
  "stream_key": "",
  "base_url": "http://upload.youtube.com/closedcaption",
  "region": "reg1",
  "cue": "cue1",
  "sequence": 0
}
```

> The Python library accepts both `snake_case` and `camelCase` keys when reading — making the config file interoperable with the Node.js library.

---

## `LCYTConfig` Dataclass

```python
@dataclass
class LCYTConfig:
    stream_key: str = ""
    base_url: str = "http://upload.youtube.com/closedcaption"
    region: str = "reg1"
    cue: str = "cue1"
    sequence: int = 0
```

| Field | Type | Default | Description |
|---|---|---|---|
| `stream_key` | `str` | `""` | YouTube Live stream key |
| `base_url` | `str` | `'http://upload.youtube.com/closedcaption'` | Caption ingestion base URL |
| `region` | `str` | `'reg1'` | Region identifier |
| `cue` | `str` | `'cue1'` | Cue identifier |
| `sequence` | `int` | `0` | Sequence counter |

### Methods

| Method | Description |
|---|---|
| `to_dict()` | Convert to `dict` for serialisation |
| `LCYTConfig.from_dict(data)` | Create from a `dict` (accepts both `snake_case` and `camelCase` keys) |

---

## Functions

### `get_default_config_path()`

Return the default config file path.

```python
path = get_default_config_path()
# PosixPath('/home/alice/.lcyt-config.json')
```

**Returns:** `Path`

---

### `load_config(config_path=None)`

Load configuration from a JSON file. Returns defaults for any missing field.

```python
config = load_config()                                # default path
config = load_config("/custom/path/config.json")     # custom path
config = load_config(Path("/custom/path/config.json"))
```

| Parameter | Type | Description |
|---|---|---|
| `config_path` | `Path \| str \| None` | Path to config file. `None` uses the default path. |

**Returns:** `LCYTConfig`

**Raises:** `ConfigError` if the file exists but cannot be read or parsed.

---

### `save_config(config, config_path=None)`

Persist a `LCYTConfig` instance to disk as JSON.

```python
save_config(config)                              # default path
save_config(config, "/custom/path/config.json") # custom path
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `LCYTConfig` | Configuration object to save |
| `config_path` | `Path \| str \| None` | Path to write. `None` uses the default path. |

**Returns:** `None`

**Raises:** `ConfigError` if the file cannot be written.

---

### `build_ingestion_url(config)`

Construct the full YouTube caption ingestion URL from a config object.

```python
url = build_ingestion_url(config)
# 'http://upload.youtube.com/closedcaption?cid=xxxx-xxxx-xxxx-xxxx'
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `LCYTConfig` | Must have a non-empty `stream_key` |

**Returns:** `str` — full ingestion URL

**Raises:** `ConfigError` if `stream_key` is empty.

---

## Example: CLI-style Config Merge

```python
import sys
from lcyt.config import load_config, save_config, build_ingestion_url

# Load existing config
config = load_config()

# Override with CLI argument
if len(sys.argv) > 1:
    config.stream_key = sys.argv[1]

# Persist updated config
save_config(config)

# Build the ingestion URL
url = build_ingestion_url(config)
print("Sending to:", url)
```
