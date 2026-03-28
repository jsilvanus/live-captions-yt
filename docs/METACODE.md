# LCYT Metacode Reference

Caption files (`.txt`) can embed HTML comment metacodes to control caption delivery, file
navigation, timing, metadata, and DSK graphics overlays. Metacodes are HTML comments and
are stripped from caption text before sending, so viewers and YouTube never see them.

---

## Syntax

```
<!-- key: value -->
```

Multiple metacodes may appear on the same line:

```
<!-- section: Intro --><!-- speaker: Alice --><!-- lang: fi-FI -->
```

Empty value removes a previously set code:

```
<!-- lang: -->
```

Some keys use a bracket modifier (e.g. `file[server]`, `graphics[viewport]`):

```
<!-- file[server]: /path/to/remote-script.txt -->
<!-- graphics[vertical-left]: logo,banner -->
```

---

## Implementation note (refactor mapping)

Following the recent refactor, metacode responsibilities are split as follows:

- Parser: `packages/lcyt-web/src/lib/metacode-parser.js`
- Runtime helpers / send-time behaviour: `packages/lcyt-web/src/lib/metacode-runtime.js`
- Manual state / active-codes: `packages/lcyt-web/src/lib/metacode-active.js`
- Planner serializer: `packages/lcyt-web/src/lib/metacode-planner.js`
- Backend handoff / server-side helpers: `packages/lcyt-backend/src/metacode.js`
- DSK graphics processing: `packages/plugins/lcyt-dsk/src/caption-processor.js`

Compatibility re-exports for older imports remain in `packages/lcyt-web/src/lib/fileUtils.js`,
`activeCodes.js`, and `plannerUtils.js` so existing code paths continue to work.

---

## Metacode Types

| Type | Description |
|------|-------------|
| **Persistent** | Set once, applied to every caption that follows until overridden |
| **Action (one-shot)** | Produce an empty caption-line entry; fire once when the pointer reaches it |

---

## Persistent Metadata Codes

These codes affect every caption line that follows until the same key is set again or cleared
with an empty value.

### `lang`

Sets the caption and speech language for subsequent lines.

```
<!-- lang: fi-FI -->
```

- Values: BCP-47 language tag (e.g. `en-US`, `fi-FI`, `sv-SE`)
- Effect: Sent as `captionLang` to the backend on each caption
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; runtime/send-time
  behaviour lives in `packages/lcyt-web/src/lib/metacode-runtime.js`; backend handoff via
  `packages/lcyt-backend/src/metacode.js`.

### `no-translate`

Prevents automatic translation for lines that follow.

```
<!-- no-translate: true -->
<!-- no-translate: false -->
```

- Values: `true` / `false`
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; applied at send-time
  in `packages/lcyt-web/src/lib/metacode-runtime.js`.

### `section`

Names the current section or chapter.

```
<!-- section: Chorus -->
```

- Values: any string
- Effect: Included in caption codes payloads (viewer, DSK)
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; consumed by the DSK
  processor in `packages/plugins/lcyt-dsk/src/caption-processor.js`; backend handoff via
  `packages/lcyt-backend/src/metacode.js` as needed.

### `speaker`

Names the current speaker.

```
<!-- speaker: Alice -->
```

- Values: any string
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; runtime helpers in
  `packages/lcyt-web/src/lib/metacode-runtime.js` and planner serializer in
  `packages/lcyt-web/src/lib/metacode-planner.js`.

### `lyrics`

Marks subsequent lines as song lyrics.

```
<!-- lyrics: true -->
```

- Values: `true` / `false`
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; surfaced to runtime
  helpers and the planner via the metacode runtime and planner modules.

### Custom codes

Any key not in the list above is accepted and forwarded as-is to viewers and plugins.

```
<!-- my-custom-code: value -->
```

---

## Stanza Blocks

Multi-line stanza text that is shown to the viewer *before* the singer begins. The stanza is
not sent as a caption — it sets a `stanza` code on every line that follows until overridden.

```
<!-- stanza
First line of the verse
Second line of the verse
-->
Caption line that triggers the stanza display
```

- Where handled: parsed by `packages/lcyt-web/src/lib/metacode-parser.js`; compatibility
  re-exports remain in `packages/lcyt-web/src/lib/fileUtils.js`.

---

## Action Metacodes (One-shot)

Action metacodes produce an empty caption-line entry in the parsed file. When the pointer
reaches (or is advanced past) that entry, the action fires once and is consumed.

### `audio`

Toggles the browser microphone / speech-to-text capture.

```
<!-- audio: start -->
<!-- audio: stop -->
```

- Values: `start` | `stop`
- Effect: Runtime dispatch (e.g. `lcyt:audio-capture` event) handled by frontend runtime
  helpers
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; runtime dispatch in
  `packages/lcyt-web/src/lib/metacode-runtime.js` and consuming UI code.

### `timer`

After the pointer rests on this line for *N* seconds, the file automatically advances to the
next line. Useful for teleprompter-style pacing.

```
<!-- timer: 5 -->
<!-- timer: 0.5 -->
```

- Values: positive number (seconds, fractions allowed)
- Effect: schedules a deferred advancement; handled by runtime scheduling code
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; runtime scheduling in
  `packages/lcyt-web/src/lib/metacode-runtime.js`.

### `goto`

Jumps the file pointer to a specific line number. Line numbers refer to the **actual 1-based
raw file position** (the same numbers shown in the caption view gutter). If the target line
is a metadata-only line, the pointer moves to the first caption entry at or after that
position.

```
<!-- goto: 42 -->
```

- Values: positive integer (1-based raw file line number)
- Effect: resolves to an index and moves the file pointer (stops any active drain)
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; runtime resolution
  and pointer movement in `packages/lcyt-web/src/lib/metacode-runtime.js` and UI hooks.

### `file`

Switches the active caption file to another already-open file by its display name. If the
named file is not open, nothing happens.

```
<!-- file: My Script.txt -->
```

- Values: display name of an open file (exact match)
- Effect: switches active file in the frontend file store (stops the drain)
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; execution in
  runtime helpers and UI code (`packages/lcyt-web/src/lib/metacode-runtime.js`, file store).

### `file[server]`

Fetches a caption file from a URL and opens it (if not already open), then switches to it.
Relative paths are resolved against the backend URL of the current session; the session
token is added automatically as an `Authorization` header.

```
<!-- file[server]: /file/123 -->
<!-- file[server]: https://example.com/scripts/act2.txt -->
```

- Values: absolute URL or path relative to the backend URL
- Effect: fetches text, loads file into file store, and sets it active (stops drain)
- Where handled: parsed in `packages/lcyt-web/src/lib/metacode-parser.js`; fetch + execution
  in runtime helpers and UI code.

---

## Empty-send Marker (`_`)

A lone underscore `_` on its own line creates a send-codes entry: pressing Enter on it
fires the current metadata codes (e.g. `stanza`) to the viewer without sending any caption
text to YouTube. An optional label after `_` is shown in the caption view gutter.

```
_
_ intro label
```

- Where handled: parsed by `packages/lcyt-web/src/lib/metacode-parser.js` (exposes the empty-send
  pattern); compatibility re-exports in `packages/lcyt-web/src/lib/fileUtils.js`.

---

## Graphics (DSK) Metacodes

The `graphics` metacode is owned by the DSK plugin and controls overlay graphics on the
downstream-key renderer. Plugin handling remains inside the plugin package.

### `graphics`

Updates the active overlay graphic names for all viewports (or specific ones):

```
<!-- graphics: logo,banner -->   all viewports: absolute set
<!-- graphics: +logo -->         delta: add logo
<!-- graphics: -banner -->       delta: remove banner
<!-- graphics: -->               clear all graphics
```

### `graphics[viewport]`

Targets a specific viewport or a comma-separated list of viewports.

```
<!-- graphics[vertical-left]: stanza,logo -->
<!-- graphics[v1,v2]: stanza -->
<!-- graphics[vertical-right]: -->   clear this viewport
```

Landscape aliases: `landscape`, `default`, `main` all refer to the same default viewport.

- Effect: emits DSK SSE events to overlay pages and updates RTMP overlay state
- Where handled: `packages/plugins/lcyt-dsk/src/caption-processor.js` (the graphics pipeline
  remains in the DSK plugin). Backend metacode handoff helpers live in
  `packages/lcyt-backend/src/metacode.js`.

---

## Line Numbering

Line numbers in the caption view gutter reflect the **actual 1-based position in the raw
text file** — the same number shown in a text editor. Metadata-only lines and blank lines
are consumed during parsing, so gaps may appear in the sequence. The `<!-- goto: N -->`
metacode uses these raw line numbers.

---

## Metacode Quick Reference

| Metacode | Type | Where resolved |
|----------|------|----------------|
| `lang: <bcp47>` | Persistent | `packages/lcyt-web/src/lib/metacode-parser.js` → runtime `packages/lcyt-web/src/lib/metacode-runtime.js`; backend handoff `packages/lcyt-backend/src/metacode.js` |
| `no-translate: true\|false` | Persistent | `packages/lcyt-web/src/lib/metacode-parser.js` → runtime `packages/lcyt-web/src/lib/metacode-runtime.js` |
| `section: <name>` | Persistent | `packages/lcyt-web/src/lib/metacode-parser.js` → `packages/plugins/lcyt-dsk/src/caption-processor.js` |
| `speaker: <name>` | Persistent | `packages/lcyt-web/src/lib/metacode-parser.js` → `packages/lcyt-web/src/lib/metacode-runtime.js` |
| `lyrics: true\|false` | Persistent | `packages/lcyt-web/src/lib/metacode-parser.js` → planner `packages/lcyt-web/src/lib/metacode-planner.js` |
| `audio: start\|stop` | Action | `packages/lcyt-web/src/lib/metacode-parser.js` → runtime `packages/lcyt-web/src/lib/metacode-runtime.js` |
| `timer: <seconds>` | Action | `packages/lcyt-web/src/lib/metacode-parser.js` → runtime `packages/lcyt-web/src/lib/metacode-runtime.js` |
| `goto: <line>` | Action | `packages/lcyt-web/src/lib/metacode-parser.js` → runtime `packages/lcyt-web/src/lib/metacode-runtime.js` |
| `file: <name>` | Action | `packages/lcyt-web/src/lib/metacode-parser.js` → runtime helpers |
| `file[server]: <path>` | Action | `packages/lcyt-web/src/lib/metacode-parser.js` → runtime helpers (fetch + fileStore) |
| `stanza` block | Block | `packages/lcyt-web/src/lib/metacode-parser.js` (compatibility re-exports in `fileUtils.js`) |
| `graphics: <names>` | In-text | `packages/plugins/lcyt-dsk/src/caption-processor.js` |
| `graphics[vp]: <names>` | In-text | `packages/plugins/lcyt-dsk/src/caption-processor.js` |

---

## Refactor Plan

The scoped implementation plan for clarifying core metacode handling lives in
`docs/plans/plan_metacode_refactor.md`.

Plan boundaries:

- Keep plugin metacode handling as-is (DSK graphics pipeline remains in
  `packages/plugins/lcyt-dsk/src/caption-processor.js`).
- Core backend metacode handoff lives in `packages/lcyt-backend/src/metacode.js`.
- Frontend parser/runtime/manual-state/planner helpers live in
  `packages/lcyt-web/src/lib/metacode-parser.js`, `packages/lcyt-web/src/lib/metacode-active.js`,
  `packages/lcyt-web/src/lib/metacode-planner.js`, and
  `packages/lcyt-web/src/lib/metacode-runtime.js`.
- Keep compatibility re-exports in `packages/lcyt-web/src/lib/fileUtils.js`,
  `activeCodes.js`, and `plannerUtils.js` where useful.

