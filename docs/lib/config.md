# Configuration

Utilities for loading, saving, and building YouTube ingestion URLs from the `lcyt` configuration file (`~/.lcyt-config.json`).

**Import**
```js
import { loadConfig, saveConfig, buildIngestionUrl, getDefaultConfigPath, getDefaultConfig } from 'lcyt/config';
// CJS
const { loadConfig, saveConfig, buildIngestionUrl } = require('lcyt/config');
```

---

## Config File

By default, configuration is stored at `~/.lcyt-config.json`. The file is plain JSON with the following shape:

```json
{
  "baseUrl": "http://upload.youtube.com",
  "streamKey": "",
  "region": "us",
  "cue": "",
  "sequence": 0
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `'http://upload.youtube.com'` | YouTube caption ingestion base URL |
| `streamKey` | `string` | `''` | YouTube Live stream key |
| `region` | `string` | `'us'` | Region hint (`us`, `eu`, `asia`) |
| `cue` | `string` | `''` | Optional cue identifier |
| `sequence` | `number` | `0` | Sequence counter persisted between runs |

---

## Functions

### `getDefaultConfigPath()`

Return the default path to the configuration file.

```js
const path = getDefaultConfigPath();
// '/home/alice/.lcyt-config.json'
```

**Returns:** `string`

---

### `getDefaultConfig()`

Return a configuration object populated with default values.

```js
const config = getDefaultConfig();
// { baseUrl: 'http://upload.youtube.com', streamKey: '', region: 'us', cue: '', sequence: 0 }
```

**Returns:** `LCYTConfig`

---

### `loadConfig(path?)`

Load configuration from a JSON file. Falls back to defaults for any missing field.

```js
const config = loadConfig();                          // default path
const config = loadConfig('/custom/path/config.json'); // custom path
```

| Parameter | Type | Description |
|---|---|---|
| `path` | `string` | Optional. File path. Defaults to `getDefaultConfigPath()`. |

**Returns:** `LCYTConfig`

**Throws:** [`ConfigError`](./errors.md#configerror) if the file exists but cannot be parsed.

---

### `saveConfig(path?, config)`

Persist a configuration object to disk as JSON.

```js
saveConfig({ ...config, streamKey: 'xxxx-xxxx-xxxx-xxxx' });
saveConfig('/custom/path/config.json', { ...config, region: 'eu' });
```

| Parameter | Type | Description |
|---|---|---|
| `path` | `string` | Optional. File path. Defaults to `getDefaultConfigPath()`. |
| `config` | `LCYTConfig` | Configuration object to save |

**Returns:** `void`

**Throws:** [`ConfigError`](./errors.md#configerror) if the file cannot be written.

---

### `buildIngestionUrl(config)`

Construct the full YouTube caption ingestion URL from a configuration object.

```js
const url = buildIngestionUrl({
  baseUrl: 'http://upload.youtube.com',
  streamKey: 'xxxx-xxxx-xxxx-xxxx',
  region: 'us',
  cue: '',
  sequence: 0,
});
// 'http://upload.youtube.com/closedcaption?cid=xxxx-xxxx-xxxx-xxxx&region=us&...'
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `LCYTConfig` | Configuration object (must include `baseUrl`, `streamKey`, `region`) |

**Returns:** `string` — Full ingestion URL

---

## TypeScript Type

```ts
interface LCYTConfig {
  baseUrl: string;
  streamKey: string;
  region: string;
  cue: string;
  sequence: number;
}
```

---

## Example: CLI-style Config Merge

```js
import { loadConfig, saveConfig, buildIngestionUrl } from 'lcyt/config';

// Load existing config
const config = loadConfig();

// Override with CLI arguments
if (process.argv[2]) config.streamKey = process.argv[2];

// Persist updated config
saveConfig(config);

// Build the ingestion URL
const url = buildIngestionUrl(config);
console.log('Sending to:', url);
```
