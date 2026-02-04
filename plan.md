# Interactive Mode Enhancement Plan

## Goal
Enhance the LCYT interactive mode to support loading text files and sending lines sequentially with a full-screen terminal UI that shows context and history.

## Features to Implement

### 1. File Loading
- Add `/load <filepath>` command to load a text file
- Parse file into array of lines
- Initialize line pointer at first line

### 2. Full-Screen Terminal UI
**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ LCYT Interactive Mode - Loaded: script.txt             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  TEXT PREVIEW (2 prev + current + 5 next):              │
│    5│ This is line 5                                    │
│    6│ This is line 6                                    │
│ ►  7│ This is the current line                          │ ◄─ Highlighted
│    8│ Next line                                         │
│    9│ Another line                                      │
│   10│ More text                                         │
│   11│ Even more                                         │
│   12│ Last preview line                                 │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  SENT HISTORY (last 5):                                 │
│   [12:34:05] Line 4 sent successfully                   │
│   [12:34:07] Line 5 sent successfully                   │
│   [12:34:09] Line 6 sent successfully                   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ Commands: Enter=Send+Next | +N/-N=Shift | /load=File   │
└─────────────────────────────────────────────────────────┘
```

### 3. Line Navigation
- **Enter**: Send current line and advance pointer to next line
- **+N**: Shift pointer forward N lines (e.g., `+3` moves 3 lines down)
- **-N**: Shift pointer backward N lines (e.g., `-2` moves 2 lines up)
- Display 2 lines before and 5 lines after current line

### 4. Sent History
- Show last 5-10 sent captions with timestamps
- Scroll/auto-update as new captions are sent
- Show success/error status for each send

### 5. Commands
- `/load <file>` - Load a text file
- `/goto <N>` - Jump to line N
- `/reload` - Reload the current file
- `/status` - Show current status (line number, total lines, etc.)
- `/heartbeat` - Send heartbeat (existing)
- `/batch` - Start batch mode (existing)
- `/send` - Send batch (existing)
- `Ctrl+C` or `/quit` - Exit

## Technical Decisions

### UI Library Choice
**Options considered:**
- **blessed** (837k weekly downloads, 11.7k stars) - Original, most popular, but unmaintained
- **neo-blessed** (13k weekly downloads, 392 stars) - Maintained fork of blessed
- **terminal-kit** (82k weekly downloads, 3.3k stars) - Alternative with different API

**Recommendation: blessed or neo-blessed**
- Mature, well-documented API
- Supports scrollable boxes, lists, and text areas
- Good for complex layouts
- neo-blessed is maintained if we need bug fixes

Alternative: Start with Node.js built-in readline and ANSI escape codes for simpler implementation, then upgrade to blessed if needed.

## Implementation Tasks

### Phase 1: Core Functionality
- [ ] Research and choose full-screen terminal UI library (blessed, terminal-kit, or ink)
- [ ] Design the screen layout (text preview area, current line, sent history, status bar)
- [ ] Implement file loading functionality (/load command)
- [ ] Implement line pointer management (current line tracking)
- [ ] Implement context display (2 previous, current, 5 next lines)

### Phase 2: Interaction
- [ ] Implement Enter key handler (send current line and advance pointer)
- [ ] Implement -N/+N commands for shifting pointer
- [ ] Implement sent history display area
- [ ] Add keyboard shortcuts and command palette

### Phase 3: Integration
- [ ] Update existing interactive mode to use new full-screen UI
- [ ] Test the enhanced interactive mode with sample text files
- [ ] Update documentation/README for new interactive mode features

## Notes
- Maintain backward compatibility with existing interactive mode
- Consider making full-screen mode opt-in via flag (e.g., `--fullscreen` or `-f`)
- Handle edge cases: empty files, very long lines, file not found
- Preserve existing features: batch mode, heartbeat, custom timestamps

## Resources
- [blessed npm package](https://www.npmjs.com/package/blessed)
- [neo-blessed (maintained fork)](https://github.com/blessedjs/neo-blessed)
- [terminal-kit npm package](https://www.npmjs.com/package/terminal-kit)
