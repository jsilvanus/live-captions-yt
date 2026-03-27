# LCYT Metacode Reference

Caption files (`.txt`) can embed HTML comment metacodes to control caption delivery, file
navigation, timing, metadata, and DSK graphics overlays.

Metacodes are HTML comments and are stripped from the caption text before sending, so viewers
and YouTube never see them.

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

## Metacode Types

| Type | Description |
|------|-------------|
| **Persistent** | Set once, tagged on every caption that follows until overridden |
| **Action (one-shot)** | Produce an empty caption line; fire once when the pointer reaches them |

---

## Persistent Metadata Codes

These codes affect every caption line that follows until the same key is set again or cleared
with an empty value.

### `lang`

Sets the caption and speech language for subsequent lines.

```
<!-- lang: fi-FI -->
```

- **Values:** BCP-47 language tag (e.g. `en-US`, `fi-FI`, `sv-SE`)
- **Effect:** Sent as `captionLang` to the backend on each caption
- **Residence:** `packages/lcyt-web/src/components/InputBar.jsx` (`doSend`) + backend `captions` route

### `no-translate`

Prevents automatic translation for lines that follow.

```
<!-- no-translate: true -->
<!-- no-translate: false -->
```

- **Values:** `true` / `false`
- **Residence:** `packages/lcyt-web/src/components/InputBar.jsx` (`doSend`)

### `section`

Names the current section or chapter.

```
<!-- section: Chorus -->
```

- **Values:** any string
- **Effect:** Sent in caption codes payload to the DSK system and viewer
- **Residence:** `packages/lcyt-web/src/lib/fileUtils.js` (parsed); `packages/plugins/lcyt-dsk/src/caption-processor.js` (consumed)

### `speaker`

Names the current speaker.

```
<!-- speaker: Alice -->
```

- **Values:** any string
- **Residence:** `packages/lcyt-web/src/lib/fileUtils.js` (parsed)

### `lyrics`

Marks subsequent lines as song lyrics.

```
<!-- lyrics: true -->
```

- **Values:** `true` / `false`
- **Residence:** `packages/lcyt-web/src/lib/fileUtils.js` (parsed)

### Custom codes

Any key not in the list above is accepted and forwarded as-is to the viewer and DSK systems.

```
<!-- my-custom-code: value -->
```

---

## Stanza Blocks

Multi-line stanza text that is shown to the viewer *before* the singer begins. The stanza is
**not** sent as a caption — it sets a `stanza` code on every line that follows until
overridden.

```
<!-- stanza
First line of the verse
Second line of the verse
-->
Caption line that triggers the stanza display
```

- **Residence:** `packages/lcyt-web/src/lib/fileUtils.js` (`parseFileContent`)

---

## Action Metacodes (One-shot)

Action metacodes produce an **empty caption line** entry in the parsed file. When the
pointer reaches (or is advanced past) this entry, the action fires once and is consumed.
The action code does **not** persist into subsequent lines.

### `audio`

Toggles the browser microphone / speech-to-text capture.

```
<!-- audio: start -->
<!-- audio: stop -->
```

- **Values:** `start` | `stop`
- **Effect:** Dispatches `lcyt:audio-capture` CustomEvent on `window`
- **Residence:** `packages/lcyt-web/src/components/InputBar.jsx` (`handleSend`, drain loop)

### `timer`

After the pointer rests on this line for *N* seconds, the file automatically advances to
the next line, triggering any further metacodes or captions in sequence. Useful for
automatic teleprompter pacing.

```
<!-- timer: 5 -->
<!-- timer: 0.5 -->
```

- **Values:** positive number (seconds, fractions allowed)
- **Effect:** Schedules a deferred `handleSend()` call; dispatches no event
- **Residence:** `packages/lcyt-web/src/lib/fileUtils.js` (parsed) +
  `packages/lcyt-web/src/components/InputBar.jsx` (`handleSend`, drain loop)

### `goto`

Jumps the file pointer to a specific line number. Line numbers refer to the **actual
1-based raw file position** (the same numbers shown in the caption view gutter), so
the number matches the line in your text editor.

If the target line is a metadata-only line, the pointer moves to the first caption entry
at or after that position.

```
<!-- goto: 42 -->
```

- **Values:** positive integer (1-based raw file line number)
- **Effect:** Calls `fileStore.setPointer()` to the resolved index; stops the current drain
- **Residence:** `packages/lcyt-web/src/lib/fileUtils.js` (parsed) +
  `packages/lcyt-web/src/components/InputBar.jsx` (`handleSend`, drain loop, `findLineIndexForRaw`)

### `file`

Switches the active caption file to another already-open file by its display name. If
the named file is not open, nothing happens.

```
<!-- file: My Script.txt -->
```

- **Values:** display name of an open file (exact match)
- **Effect:** Calls `fileStore.setActive()` for the matching file; stops the current drain
- **Residence:** `packages/lcyt-web/src/lib/fileUtils.js` (parsed) +
  `packages/lcyt-web/src/components/InputBar.jsx` (`handleSend`, `handleFileSwitchAction`)

### `file[server]`

Fetches a caption file from a URL and opens it (if not already open), then switches to it.
Relative paths are resolved against the backend URL of the current session; the session
token is added automatically as an `Authorization` header.

```
<!-- file[server]: /file/123 -->
<!-- file[server]: https://example.com/scripts/act2.txt -->
```

- **Values:** absolute URL or path relative to the backend URL
- **Effect:** `fetch()` → `fileStore.loadFileFromText()` → `fileStore.setActive()`; stops drain
- **Residence:** `packages/lcyt-web/src/lib/fileUtils.js` (parsed) +
  `packages/lcyt-web/src/components/InputBar.jsx` (`handleSend`, `handleFileSwitchAction`)

---

## Empty-send Marker (`_`)

A lone underscore `_` on its own line creates a *send-codes* entry: pressing Enter on it
fires the current metadata codes (e.g. `stanza`) to the viewer without sending any caption
text to YouTube.

```
_
_ intro label
```

An optional label after `_` is shown in the caption view gutter. This is useful for pushing
a stanza display to the viewer before the singing starts.

- **Residence:** `packages/lcyt-web/src/lib/fileUtils.js` (`parseFileContent`, `EMPTY_SEND_RE`)

---

## Graphics (DSK) Metacodes

The `graphics` metacode is part of the **DSK plugin** (`packages/plugins/lcyt-dsk`) and
controls overlay graphics on the downstream-key renderer.

### `graphics`

Updates the active overlay graphic names for all viewports (or specific ones).

```
<!-- graphics: logo,banner -->                  all viewports: absolute set
<!-- graphics: +logo -->                        delta: add logo
<!-- graphics: -banner -->                      delta: remove banner
<!-- graphics: -->                              clear all graphics
```

### `graphics[viewport]`

Targets a specific viewport or a comma-separated list of viewports.

```
<!-- graphics[vertical-left]: stanza,logo -->
<!-- graphics[v1,v2]: stanza -->
<!-- graphics[vertical-right]: -->              clear this viewport
```

Landscape aliases: `landscape`, `default`, `main` all refer to the same default viewport.

- **Effect:** Emits DSK SSE events to overlay pages; updates RTMP relay overlay
- **Residence:** `packages/plugins/lcyt-dsk/src/caption-processor.js`

---

## Line Numbering

Line numbers in the caption view gutter reflect the **actual 1-based position in the raw
text file** — the same number shown in a text editor. Metadata-only lines and blank lines
are not shown (they are consumed during parsing), so gaps may appear in the sequence.

The `<!-- goto: N -->` metacode uses these same raw line numbers.

---

## Metacode Quick Reference

| Metacode | Type | Where resolved |
|----------|------|----------------|
| `lang: <bcp47>` | Persistent | `InputBar.jsx` / backend captions route |
| `no-translate: true\|false` | Persistent | `InputBar.jsx` |
| `section: <name>` | Persistent | `fileUtils.js` / DSK caption-processor |
| `speaker: <name>` | Persistent | `fileUtils.js` |
| `lyrics: true\|false` | Persistent | `fileUtils.js` |
| `audio: start\|stop` | Action | `InputBar.jsx` drain loop |
| `timer: <seconds>` | Action | `InputBar.jsx` drain loop |
| `goto: <line>` | Action | `InputBar.jsx` drain loop |
| `file: <name>` | Action | `InputBar.jsx` `handleFileSwitchAction` |
| `file[server]: <path>` | Action | `InputBar.jsx` `handleFileSwitchAction` |
| `stanza` block | Block | `fileUtils.js` |
| `graphics: <names>` | In-text | `lcyt-dsk/caption-processor.js` |
| `graphics[vp]: <names>` | In-text | `lcyt-dsk/caption-processor.js` |
