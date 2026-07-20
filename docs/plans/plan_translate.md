# Plan: Server-Side Translation Plugin (`lcyt-translate`)

**Status:** Partially superseded (2026-07-20) — see note below. The specific architecture in this
document (a standalone `lcyt-translate` plugin, a new `stt_translate_config` table, `GET/PUT
/translate/config`, operator-level env-var vendor keys) was **not built**.
**Date:** 2026-03-26
**Context:** Extracted from `plan_backend_split.md` — plugin splitting section.
**Related:** `plan/server-stt` (Phase 5), `plan/translations`

---

## Status Note (2026-07-20)

Gap #1 below (server-side STT bypassing translation) **has been closed**, but by a different,
simpler mechanism than the one proposed in this document — see `plan_server_stt.md` Phase 5
("Server-side translation for server-STT transcripts"), implemented and verified:

- The translation call lives in `packages/plugins/lcyt-rtmp/src/translate-server.js`
  (`translateText`/`isSameLanguage`) — colocated with `SttManager` in `lcyt-rtmp`, not a new
  `lcyt-translate` plugin package.
- It reuses the **already-existing** `translation_vendor_config`/`translation_targets` tables
  (`packages/lcyt-backend/src/db/translation-config.js`, built for the self-service/client config
  UI per `plan_selfservice_config_backend.md` §1) — no new `stt_translate_config` table, and
  per-user vendor API keys are already stored there, not gated behind operator-level env vars as
  this doc's Phase 1 recommended.
- Wiring is `SttManager.setDeliveryHelpers({ getTranslationVendorConfig, getTranslationTargets,
  … })`, called once from `server.js`, not a `translateManager` constructor option.
- There is no separate `/translate/config` HTTP API — config is read/written through the existing
  `GET/PUT /translation/config*` routes (`packages/lcyt-backend/src/routes/translation.js`).

Gap #2 below (API/generic/CLI clients that `POST /captions` directly with no `translations` map)
is **still open** — `packages/lcyt-backend/src/routes/captions.js` has no server-side translation
step; it only composes/fans-out whatever `translations` the client already supplied. If that gap is
ever closed, the STT precedent above (reuse `translation_vendor_config`/`translation_targets` +
`translate-server.js`-style module, not a new plugin) is the template to follow — this document's
plugin-package/new-table/new-route design should be considered superseded rather than revived
as-is.

## Background and Motivation

Translation currently runs entirely in the browser (`packages/lcyt-web/src/lib/translate.js`). The client calls MyMemory, Google Cloud, DeepL, or LibreTranslate directly, then sends the resulting `{ text, translations: { 'fi-FI': '...' }, captionLang, showOriginal }` payload to `POST /captions`. The backend is a pass-through — it receives translated text and distributes it to targets.

This works well for the browser workflow but has two gaps:

1. **Server-side STT (`SttManager`)** — transcripts arrive inside `session._sendQueue` on the server without ever touching the browser. The STT path bypasses the translation pipeline entirely: `SttManager.#injectCaption` calls `session._sendQueue.then(...)` directly with the raw transcript, so no translation occurs even when the user has translation targets configured.

2. **API / generic clients** — tools that POST to `/captions` directly (CLI, MCP, relay) cannot use browser translation. They must either translate themselves or send raw text.

An `lcyt-translate` plugin would close these gaps by giving the server an optional translation step that sits in the caption send path.

**Caveat:** Whether server-side translation is worth the operational cost (API keys on the server, latency in the send queue, vendor abstraction maintenance) is an open question. This plan is written as a complete blueprint so the decision can be made later with full information.

---

## Current Client-Side Architecture (for reference)

```
lcyt-web
  └─ AudioPanel / InputBar
       └─ translateAll(text, sourceLang, enabledTranslations)
            ├─ translateMyMemory / translateGoogle / translateDeepL / translateLibre
            └─ returns { translationsMap, captionLang, localFileEntries }
  └─ POST /captions  { text, translations: { 'fi-FI': '...' }, captionLang, showOriginal }
```

Config stored in `localStorage` (vendor, API key, LibreTranslate URL). Each translation target has a `lang` and a `target` field: `'captions'` (show in YouTube), `'backend-file'` (save on server), or `'file'` (save in browser via File System Access API).

---

## Proposed Architecture

### Translation adapter interface

Mirrors the STT adapter pattern in `lcyt-rtmp`:

```js
/**
 * @typedef {object} TranslationAdapter
 * @property {(text: string, sourceLang: string, targetLang: string) => Promise<string>} translate
 */
```

### Plugin structure

```
packages/plugins/lcyt-translate/
├── package.json
├── src/
│   ├── api.js                    ← initTranslateControl(db) + createTranslateRouters(db, auth)
│   ├── translate-manager.js      ← TranslateManager: per-key config, translate(apiKey, text, sourceLang)
│   ├── adapters/
│   │   ├── mymemory.js
│   │   ├── google.js
│   │   ├── deepl.js
│   │   └── libretranslate.js
│   └── db.js                     ← stt_translate_config table migrations + CRUD
└── test/
    ├── translate-manager.test.js
    └── adapters/
        ├── mymemory.test.js
        └── google.test.js
```

### Per-key translation config (DB)

New table `stt_translate_config`:

```sql
CREATE TABLE IF NOT EXISTS stt_translate_config (
  api_key         TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 0,
  vendor          TEXT    NOT NULL DEFAULT 'mymemory',
  source_lang     TEXT    NOT NULL DEFAULT 'en-US',
  -- JSON array: [{ lang, target }]
  -- target: 'captions' | 'backend-file'
  targets_json    TEXT,
  -- vendor API key (stored encrypted or as plaintext — see §Security)
  vendor_api_key  TEXT,
  -- for LibreTranslate
  libre_url       TEXT,
  libre_api_key   TEXT,
  updated_at      TEXT DEFAULT (datetime('now'))
);
```

Config is managed via two HTTP endpoints (mirrors `GET/PUT /stt/config`):

```
GET  /translate/config   — get per-key config (Bearer token)
PUT  /translate/config   — update per-key config (Bearer token)
```

### `TranslateManager`

```js
export class TranslateManager {
  // Returns a translations map { 'fi-FI': '...', ... } for all configured targets.
  // Returns {} if translation is disabled or no targets configured for this key.
  async translate(apiKey, text, sourceLangOverride) {
    const config = this.getConfig(apiKey);
    if (!config?.enabled || !config.targets?.length) return {};
    const adapter = this._getAdapter(config);
    const sourceLang = sourceLangOverride ?? config.source_lang;
    const results = {};
    await Promise.allSettled(
      config.targets.map(async ({ lang }) => {
        if (isSameLanguage(sourceLang, lang)) { results[lang] = text; return; }
        results[lang] = await adapter.translate(text, sourceLang, lang).catch(() => text);
      })
    );
    return results;
  }
}
```

### Injection into the caption send queue

`createCaptionsRouter` receives an optional `translateManager`:

```js
export function createCaptionsRouter(store, auth, db, relayManager, dskProcessor, translateManager) {
  // ...inside session._sendQueue.then(async () => { ... }):

  if (translateManager) {
    for (const caption of resolvedCaptions) {
      if (!caption.translations) {
        // Only translate if the client hasn't already done it
        const translations = await translateManager.translate(session.apiKey, caption.text ?? '');
        if (Object.keys(translations).length > 0) {
          caption.translations = translations;
          // Determine captionLang from the config's first 'captions'-target entry
          const cfg = translateManager.getConfig(session.apiKey);
          caption.captionLang = cfg?.targets?.find(t => t.target === 'captions')?.lang ?? null;
        }
      }
    }
  }
```

This runs **before** `composeCaptionText` and `writeToBackendFile`, so both the composed YouTube text and the backend file write paths see the server-supplied translations. Client-supplied `translations` are not overwritten (the `if (!caption.translations)` guard).

### Injection into SttManager

`SttManager.#injectCaption` currently pushes the raw transcript directly. With `translateManager`:

```js
// In stt-manager.js:
async #injectCaption(apiKey, transcript, options = {}) {
  const session = this.#store?.getByApiKey?.(apiKey);
  if (!session) return;

  let translations = {};
  if (this.#translateManager) {
    translations = await this.#translateManager.translate(apiKey, transcript).catch(() => ({}));
  }
  const captionLang = /* from translateManager config */ null;

  session._sendQueue = session._sendQueue.then(async () => {
    // build caption with translations if any
    const text = composeCaptionText(transcript, captionLang, translations, false);
    // ... send logic ...
  });
}
```

`SttManager` receives `translateManager` as a constructor option:

```js
const sttManager = new SttManager(db, store, { translateManager });
```

Wired in `server.js`:

```js
const { translateManager } = initTranslateControl(db);
const rtmp = await initRtmpControl(db, store, { translateManager });
```

---

## Adapter Implementations

The four adapters mirror the browser implementations in `lcyt-web/src/lib/translate.js` but run in Node.js using `fetch` (available natively since Node 18).

### `adapters/mymemory.js`
```js
export async function translate(text, sourceLang, targetLang, _apiKey) {
  const src = toLang2(sourceLang), tgt = toLang2(targetLang);
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${src}|${tgt}`;
  const data = await fetch(url).then(r => r.json());
  if (data.responseStatus !== 200) throw new Error(data.responseDetails || 'MyMemory error');
  return data.responseData?.translatedText ?? text;
}
```

### `adapters/google.js`
```js
export async function translate(text, sourceLang, targetLang, apiKey) {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
  const data = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: toLang2(sourceLang), target: toLang2(targetLang), format: 'text' }) })
    .then(r => r.json());
  return data.data?.translations?.[0]?.translatedText ?? text;
}
```

### `adapters/deepl.js` / `adapters/libretranslate.js`
Follow the same pattern as the browser versions.

---

## HTTP API

### `GET /translate/config`
Bearer token (session JWT or user JWT).

Response:
```json
{
  "enabled": false,
  "vendor": "mymemory",
  "source_lang": "en-US",
  "targets": [
    { "lang": "fi-FI", "target": "captions" }
  ]
}
```

The `vendor_api_key` field is **never returned** in GET responses.

### `PUT /translate/config`
```json
{
  "enabled": true,
  "vendor": "deepl",
  "vendor_api_key": "abc:fx",
  "source_lang": "en-US",
  "targets": [
    { "lang": "fi-FI", "target": "captions" },
    { "lang": "sv-SE", "target": "backend-file" }
  ]
}
```

---

## Security Considerations

**Vendor API keys stored server-side:** The `vendor_api_key` column stores translation vendor credentials for each user. This is the most sensitive aspect of this design.

Options in order of preference:
1. **Encrypt at rest** — use `aes-256-gcm` with a key derived from `JWT_SECRET` (or a separate `TRANSLATE_KEY_SECRET`). Encrypt on write, decrypt on read. Adds complexity but protects against DB dump.
2. **Store plaintext, trust DB access controls** — simplest; acceptable if the DB file is protected by filesystem permissions and not exposed.
3. **Per-vendor server-level API keys only** — skip per-user keys entirely; the operator sets `GOOGLE_TRANSLATE_KEY` / `DEEPL_KEY` env vars and all users share them. Removes the per-user key problem but means the operator pays for all translation.

For the initial implementation, option 3 (operator-level env vars only) is the lowest risk and easiest to reason about. Per-user keys can be added later.

### Operator-level env vars (option 3)

| Variable | Purpose |
|---|---|
| `TRANSLATE_VENDOR` | Default vendor for all keys: `mymemory`, `google`, `deepl`, `libretranslate` |
| `TRANSLATE_SOURCE_LANG` | Default source language (BCP-47) |
| `GOOGLE_TRANSLATE_KEY` | Google Cloud Translation API key |
| `DEEPL_KEY` | DeepL API key |
| `LIBRETRANSLATE_URL` | LibreTranslate base URL |
| `LIBRETRANSLATE_KEY` | LibreTranslate API key (optional) |

Per-key config in DB stores only `enabled`, `source_lang`, and `targets` (no vendor key).

---

## Latency Impact

Translation adds latency to the send queue. For a single caption sent to one target:
- **MyMemory:** ~200–500 ms (free tier, rate-limited at ~1000 req/day/IP)
- **Google Cloud:** ~100–200 ms
- **DeepL:** ~100–300 ms
- **LibreTranslate (self-hosted):** ~50–200 ms (hardware dependent)

For live captioning this is marginal — the YouTube ingestion API itself typically takes 200–600 ms. However, if a user configures 3–4 translation targets, `Promise.allSettled` runs them concurrently so the total overhead is max(individual latencies), not sum.

Mitigation: add a configurable `TRANSLATE_TIMEOUT_MS` (default 2000ms) that aborts slow translation calls and falls back to the original text.

---

## Relationship to Client-Side Translation

Server-side and client-side translation are **not mutually exclusive**. The guard `if (!caption.translations)` in `createCaptionsRouter` means:
- If the browser sends translations → server uses them (existing behaviour, unchanged).
- If the browser sends no translations (e.g. CLI, MCP, STT path) → server translates if configured.

This is the correct behaviour: browser translation remains the primary path for the web UI; server-side translation fills in the gaps.

---

## Implementation Steps

1. **Create `packages/plugins/lcyt-translate/`** — package.json, src/ skeleton.
2. **Implement `db.js`** — `stt_translate_config` table migration, `getTranslateConfig`, `setTranslateConfig`.
3. **Implement adapters** — mymemory, google, deepl, libretranslate (port from lcyt-web/src/lib/translate.js).
4. **Implement `TranslateManager`** — constructor, `translate(apiKey, text, sourceLang?)`, `getConfig(apiKey)`.
5. **Implement `api.js`** — `initTranslateControl(db)`, `createTranslateRouters(db, auth)` (GET/PUT /translate/config).
6. **Wire into `createCaptionsRouter`** — inject translateManager, add translation step before composeCaptionText.
7. **Wire into `SttManager`** — accept translateManager constructor option, call in `#injectCaption`.
8. **Wire in `server.js`** — initialise, pass to rtmp and captions.
9. **Tests** — per-adapter unit tests (mock fetch), TranslateManager integration test with in-memory DB.
10. **lcyt-web UX (future)** — add "server-side" toggle in the CC → Translations tab so users know translation is handled by the backend for STT sessions.

---

## Summary

| Aspect | Decision |
|---|---|
| Plugin name | `lcyt-translate` |
| Primary use case | Fill STT + CLI translation gap |
| Client-side translation | Unchanged; server is opt-in |
| API key storage | Operator env vars only (phase 1); per-user encrypted (phase 2) |
| Vendor support | MyMemory, Google Cloud, DeepL, LibreTranslate |
| Latency risk | Concurrent `Promise.allSettled` + 2s timeout; acceptable for live use |
| DB schema | New `stt_translate_config` table |
| Breaking changes | None |

This plan is **partially superseded** (see Status Note above, 2026-07-20) — the STT gap this
document set out to close is real and has since been closed, but via `plan_server_stt.md` Phase 5's
lighter-weight design (reusing existing tables, colocated in `lcyt-rtmp`), not the standalone
`lcyt-translate` plugin proposed here. The remaining gap (API/generic/CLI clients bypassing
translation on direct `POST /captions`) is unaddressed by any implemented mechanism; this document
remains useful as a design reference for that gap, but should not be scheduled as originally
written.
