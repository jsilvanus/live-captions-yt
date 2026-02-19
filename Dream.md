# Dream.md — Future Features for lcyt Fullscreen CLI

Ideas for what we could build now that we have a YouTube Data API key available in the fullscreen UI.
All of these are technically feasible with the YouTube Data API v3 and the existing blessed terminal framework.

---

## 1. Live Chat Panel

Add a fourth panel (or replace the log panel on demand) that polls the YouTube live chat every few seconds and streams incoming messages in real time.

```
┌──────────────┬──────────────┬───────────────┐
│ Script       │ Sent         │ Live Chat     │
│ ► Line 12   │ #42 Hello   │ viewer1: 👋   │
│   Line 13   │ #41 World   │ viewer2: hi   │
├──────────────┴──────────────┤ mod: !sub     │
│ Log                         │               │
└─────────────────────────────┴───────────────┘
```

- `/chat` toggles the chat panel on/off
- Messages auto-scroll; moderator messages highlighted in yellow
- Super Chats appear in gold with the donation amount
- Member messages get a badge icon

---

## 2. Caption-from-Chat — Crowd-Sourced Captioning

Let the audience help. Viewers type `!caption <text>` in chat. The CLI captures those messages and queues them in a pending tray for the operator to approve or discard with a single keypress.

- `a` → approve and send the top pending caption
- `d` → discard it
- Timestamps auto-adjusted to current time on approval

Good for accessibility streams where volunteers help caption.

---

## 3. Q&A Queue

Filter the live chat for questions (messages ending in `?` or tagged with `#q`) and collect them into a dedicated Q&A queue panel.

- `/qa` opens the queue
- Arrow keys navigate the queue
- Enter sends the selected question as a caption (so the audience knows which question is being answered)
- Questions marked as answered get struck through and archived

---

## 4. Viewer Count & Chat Rate in Status Bar

The Data API returns `concurrentViewers` on the `liveStreamingDetails` resource. Show it live in the status bar alongside a chat messages-per-minute rate.

```
Key:XXXX | Seq:42 | L:12/80 | ● Live  👁 1,204  💬 38/min
```

Viewer count refreshes every 30 seconds alongside the existing status poll.

---

## 5. Teleprompter Auto-Advance

A timed auto-scroll mode that advances through the loaded script at a configurable words-per-minute rate and sends each line automatically as a caption when the pointer reaches it.

- `/tp <wpm>` starts teleprompter mode (default 130 wpm)
- Line advance time is calculated from the word count of the current line
- Space bar pauses/resumes
- `+` / `-` adjusts speed live without stopping
- A progress bar in the title shows percent through the script

Operators can load a prepared script before going live and just monitor.

---

## 6. SRT / VTT Import

Load a subtitle file (`.srt` or `.vtt`) as the caption source. The CLI parses the timestamps and queues each cue so that pressing Enter sends the next cue at the correct offset from the stream start time.

- `/load script.srt` detects the extension and parses cue timings
- In the preview panel each cue shows its original start time alongside the line text
- In replay mode the CLI auto-sends cues at the right wall-clock time (offset from `/stream start`)

Useful for re-streaming a recorded talk with pre-made subtitles.

---

## 7. Transcript Export

Every sent caption is already in the "Sent" panel's in-memory list. Add an export command that writes them to disk as a timestamped transcript.

- `/export` → saves `transcript-YYYY-MM-DD-HHMMSS.txt`
- `/export srt` → saves as `.srt` subtitle file using the sequence timestamps
- `/export vtt` → saves as `.vtt`

The SRT/VTT exports can be used directly as closed-caption files for the VOD after the stream ends.

---

## 8. Stream Title / Description Live Editor

Use the YouTube Data API (with OAuth — an upgrade from the current read-only API key flow) to update the broadcast title or description without leaving the terminal.

- `/title New stream title here` → patches the broadcast resource
- `/desc Line one\nLine two` → updates description
- Confirmation shown in the log box

Lets the operator fix a typo in the stream title mid-broadcast without alt-tabbing to Studio.

---

## 9. Keyword Alert Highlights

Define a watchlist of words or phrases. When any appear in incoming chat messages, the message is highlighted in the chat panel and a brief bell/flash fires on the log panel.

- `/watch <word>` adds a keyword
- `/unwatch <word>` removes it
- `/watchlist` shows current list
- Useful for alerting the captioner when their name is called or a topic shift is happening

---

## 10. Caption Replay Mode

Load a previously exported transcript and replay it as if it were being sent live — useful for rehearsal, testing, or adding captions to a re-run.

- `/replay transcript-2026-02-19.txt`
- Timestamps from the file are used as offsets from `now`
- Playback speed adjustable (`/replay 2x`)
- `/replay pause` / `/replay resume`

---

## 11. Multi-Track Caption Routing

YouTube supports multiple caption tracks (e.g., English and Spanish). Route captions to two tracks simultaneously: one with the original text and one piped through a translation API.

- `/track add <language> <stream-key>` registers a second ingestion endpoint
- All sends go to both tracks in parallel
- The translation call is async; the translated caption is sent with a slight delay offset
- Translation powered by any REST API (LibreTranslate, DeepL, etc.) — the operator configures the endpoint and key in a JSON file

---

## 12. Super Chat Alert Overlay

When a Super Chat arrives via the chat poll, interrupt the current view with a brief full-width banner at the top of the screen (like a ticker), then log it permanently in the chat panel.

```
╔══════════════════════════════════════════╗
║  🌟 Super Chat  $20.00  — alice123      ║
║  "Thanks for the captions, keep it up!" ║
╚══════════════════════════════════════════╝
```

Auto-dismisses after 8 seconds. The message text is also pushed into the batch caption queue so it can be captioned with one keypress.

---

## 13. Session Statistics Dashboard

At stream end (or on `/stats`), show a summary modal:

```
── Session Summary ──────────────────────
  Duration          1h 23m 14s
  Captions sent     284
  Captions / min    3.4
  Peak viewers      1,872
  Super Chats       7  ($64.00)
  Chat messages     2,341
  Questions queued  18  (answered: 14)
─────────────────────────────────────────
  Export transcript?  [y/n]
```

All data collected from the in-process state during the session — no extra API calls required beyond what the status poller already makes.

---

## 14. Caption Search in Sent Panel

Add incremental search over the sent captions history.

- `/search <term>` filters the Sent panel to matching captions
- Highlight matches in bold
- `n` / `N` jumps between matches
- `/search` with no argument clears the filter

---

## 15. Adaptive Poll Interval

The current status poll fires every 30 seconds regardless of stream state. Make it smarter:

- When `liveBroadcastContent` is `upcoming`, poll every 60 seconds (stream hasn't started, no need to rush)
- When `live`, poll every 10 seconds so viewer count stays fresh
- When `offline`, poll every 120 seconds and offer to auto-quit when the stream ends

---

## Implementation Priority Suggestion

| Feature | API needed | Complexity | Impact |
|---|---|---|---|
| Viewer count in status bar | Data API v3 (current) | Low | High |
| Transcript export (txt) | None | Low | High |
| Teleprompter auto-advance | None | Medium | High |
| SRT/VTT import | None | Medium | High |
| Live chat panel | Data API v3 (current) | Medium | High |
| Q&A queue | Data API v3 (current) | Medium | Medium |
| Keyword alerts | Data API v3 (current) | Low | Medium |
| Super Chat alerts | Data API v3 (current) | Medium | Medium |
| Caption search | None | Low | Medium |
| Transcript export (SRT/VTT) | None | Medium | Medium |
| Session statistics | None | Low | Medium |
| Adaptive poll interval | Data API v3 (current) | Low | Low |
| Caption-from-chat | Data API v3 (current) | High | Medium |
| Multi-track routing | None (two stream keys) | High | Low |
| Stream title editor | OAuth (new) | High | Low |

Items in the top half of the table can all be built with the API key flow already in place.
