---
title: Sending Captions
order: 3
---

# Sending Captions

LCYT gives you several ways to get text onto the stream. You can use them in any combination during a session.

---

## The input bar

The **input bar** sits at the bottom of the app. Type your caption text here and press **Enter** to send it immediately.

![Input bar](/screenshots/inputbar-light.png)

- **Clear** — remove the text without sending
- **Send** button — same as Enter

> **Tip:** After sending, the input bar is cleared automatically so you can type the next caption right away.

---

## Microphone (Speech-to-Text)

Click the microphone button (🎙) to start continuous speech recognition. Words are transcribed and displayed in the caption preview area in real time. The system sends each completed utterance as a caption automatically.

See [Caption settings → Model tab](caption-settings#model) for engine and language selection.

### Desktop

The audio meter and mic toggle are embedded in the **left panel**.

### Mobile

On phones, the mic button lives in the **mobile audio bar** at the bottom of the screen.

![Mobile audio bar](/screenshots/mobile-audio-bar-light.png)

The mobile bar contains (left to right):

| Button | Action |
|--------|--------|
| Audio meter | Shows microphone volume in real time |
| 🎙 / ⏹ | Toggle speech recognition on/off |
| − | Go to previous line (script mode) |
| ► | Send current line |
| + | Go to next line (script mode) |

---

## Loading a script file

You can load a pre-written caption script (plain text, one caption per line) by:

- **Dragging and dropping** the file onto the drop zone in the left panel, or
- Clicking the **drop zone** to open a file picker.

![Left panel with drop zone](/screenshots/panel-left-light.png)

Once loaded, the file appears as a **tab** above the caption view. The current line is highlighted.

### Navigating and sending file captions

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Send current line | `Enter` | ► button |
| Next line | `↓` / `Page Down` | + button |
| Previous line | `↑` / `Page Up` | − button |
| First line | `Home` | — |
| Last line | `End` | — |
| Cycle file tabs | `Tab` | — |

---

## Caption file format

Caption files are plain text (`.txt`), one caption per line. In addition to plain text, the file format supports **metadata comments**, **stanza blocks**, and **empty-send markers**.

### Metadata comments

HTML-style comments on their own line attach metadata codes to all subsequent caption lines. Any key is accepted.

```
<!-- lang: fi-FI -->
<!-- section: chorus -->
<!-- speaker: Alice -->
<!-- lyrics: true -->
<!-- no-translate: true -->
```

To clear a code, set its value to empty:

```
<!-- lang: -->
```

Metadata comment lines are not sent as captions.

### Stanza blocks

A stanza block attaches multi-line "singing aid" text to subsequent captions so viewers can see the upcoming lyrics. Open the block with `<!-- stanza` (no closing `-->`), write the stanza lines, then close with `-->` on its own line.

```
<!-- stanza
Amazing grace, how sweet the sound
That saved a wretch like me
-->
Amazing grace, how sweet the sound
That saved a wretch like me
```

The stanza text is pushed to the viewer when the first caption in the block is sent. To clear the stanza, add an empty block:

```
<!-- stanza
-->
```

### Empty-send markers

A line containing only `_` fires the current metadata codes (including the active stanza) to the viewer **without sending any caption text** to YouTube. This is useful for pushing a stanza to the viewer before the singing starts.

```
<!-- stanza
Amazing grace, how sweet the sound
-->
_
Amazing grace, how sweet the sound
```

You can optionally add a label after the underscore. The label is shown in **red** in the caption view as a visual cue for the operator — it is never sent to YouTube.

```
_ Show verse 1
_ ♪ Chorus
_ [pause here]
```

A bare `_` displays a dimmed `⊘ send codes` indicator. A labeled `_ text` displays the label text in red.

---

## Batch mode

Batch mode lets you queue multiple captions and send them at regular intervals. This is useful for pre-written scripts where you want smooth, evenly timed delivery.

Configure the **batch interval** in [Caption settings → Other tab](caption-settings#other).

---

## Sent captions log

The **right panel** shows every caption you have sent in the current session, newest at the top. You can scroll back to review what was sent.

![Sent captions log](/screenshots/panel-right-light.png)
