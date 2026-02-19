import blessed from 'blessed';
import { readFileSync } from 'fs';
import { resolve, basename } from 'path';
import logger from 'lcyt/logger';
import { saveConfig } from 'lcyt/config';

export class InteractiveUI {
  constructor(sender, config, configPath, defaultTimestamp) {
    this.sender = sender;
    this.config = config;
    this.configPath = configPath;
    this.defaultTimestamp = defaultTimestamp;

    // File / URL content tracking
    this.loadedFile = null;
    this.lines = [];
    this.currentLine = 0;

    // Right panel: sent captions list
    this.sentCaptions = [];
    this.maxSentCaptions = 500;
    this.showTimestamps = true;

    // Left lower panel: operational log
    this.logMessages = [];
    this.maxLogMessages = 500;

    // Batch mode
    this.batchMode = false;
    this.batchCaptions = [];
    this.batchTimeout = 5; // seconds
    this.batchTimer = null;

    // YouTube live status polling
    this.youtubeStatus = null; // null = unknown, 'live', 'offline'
    this.youtubePoller = null;

    // UI widgets
    this.screen = null;
    this.textPreview = null;
    this.logBox = null;
    this.captionsBox = null;
    this.statusBar = null;
    this.inputField = null;

    // Route logger output to the log panel instead of stdout
    logger.setCallback((message, type) => {
      this.addToLog(message, type);
    });
  }

  // ─── File / URL loading ──────────────────────────────────────────────────

  /**
   * Load a local text file and reset pointer to line 0.
   */
  loadFile(filepath) {
    try {
      const fullPath = resolve(filepath);
      const content = readFileSync(fullPath, 'utf-8');
      this.lines = content.split('\n');
      this.loadedFile = filepath;
      this.currentLine = 0;
      this.addToLog(`Loaded: ${filepath} (${this.lines.length} lines)`, 'info');
      return true;
    } catch (err) {
      this.addToLog(`Load error: ${err.message}`, 'error');
      return false;
    }
  }

  /**
   * Fetch text content from a URL (uses global fetch, Node ≥ 18).
   */
  async fetchUrl(url) {
    try {
      this.addToLog(`Fetching ${url} …`, 'info');
      const response = await fetch(url);
      if (!response.ok) {
        this.addToLog(
          `Fetch failed: HTTP ${response.status} ${response.statusText}`,
          'error'
        );
        return false;
      }
      const text = await response.text();
      this.lines = text.split('\n');
      this.loadedFile = url;
      this.currentLine = 0;
      this.addToLog(`Fetched: ${url} (${this.lines.length} lines)`, 'success');
      return true;
    } catch (err) {
      this.addToLog(`Fetch error: ${err.message}`, 'error');
      return false;
    }
  }

  // ─── Pointer navigation ──────────────────────────────────────────────────

  /**
   * Return the window of lines visible in the text preview box.
   * Centres around currentLine; adapts to box height.
   */
  getContextLines() {
    if (!this.textPreview || this.lines.length === 0) return [];

    const boxHeight = this.textPreview.height;
    const visible = Math.max(5, boxHeight - 2); // subtract top+bottom border

    let start = Math.max(0, this.currentLine - Math.floor(visible / 2));
    let end = Math.min(this.lines.length, start + visible);

    if (end - start < visible && start > 0) {
      start = Math.max(0, end - visible);
    }

    const result = [];
    for (let i = start; i < end; i++) {
      result.push({
        lineNum: i + 1,
        text: this.lines[i] || '',
        isCurrent: i === this.currentLine
      });
    }
    return result;
  }

  /**
   * Move pointer by offset lines (positive = forward, negative = backward).
   */
  shiftPointer(offset) {
    const target = this.currentLine + offset;
    if (target >= 0 && target < this.lines.length) {
      this.currentLine = target;
      this.updateTextPreview();
      this.updateStatus();
      return true;
    }
    return false;
  }

  /**
   * Jump to a 1-indexed line number.
   */
  gotoLine(lineNum) {
    const idx = lineNum - 1;
    if (idx >= 0 && idx < this.lines.length) {
      this.currentLine = idx;
      this.updateTextPreview();
      this.updateStatus();
      return true;
    }
    return false;
  }

  /**
   * Return true if the line at lineIndex is sendable (non-empty, not a heading).
   */
  isSendableLine(lineIndex) {
    if (lineIndex < 0 || lineIndex >= this.lines.length) return false;
    const line = this.lines[lineIndex].trim();
    return line.length > 0 && !line.startsWith('#');
  }

  // ─── Caption sending ─────────────────────────────────────────────────────

  /**
   * Send (or queue in batch mode) the current file line, then advance pointer.
   * Called when the user presses Enter with an empty input field.
   */
  async sendCurrentLine() {
    if (this.lines.length === 0 || this.currentLine >= this.lines.length) {
      this.addToLog('No content loaded', 'warn');
      return;
    }

    const text = this.lines[this.currentLine];
    const lineNum = this.currentLine + 1;

    if (!this.isSendableLine(this.currentLine)) {
      if (text.trim().length === 0) {
        this.addToLog(`Line ${lineNum}: empty — moving to next`, 'warn');
      } else {
        this.addToLog(`Line ${lineNum}: heading — skipping`, 'info');
      }
      // Still advance pointer
      if (this.currentLine < this.lines.length - 1) {
        this.currentLine++;
        this.updateTextPreview();
        this.updateStatus();
      }
      return;
    }

    if (this.batchMode) {
      this.batchCaptions.push({ text, timestamp: this.defaultTimestamp });
      if (this.batchCaptions.length === 1 && !this.batchTimer) {
        this.addToLog(
          `[L${lineNum}] Queued (1) — auto-send in ${this.batchTimeout}s`,
          'info'
        );
        this.batchTimer = setTimeout(() => this.sendBatch(), this.batchTimeout * 1000);
      } else {
        this.addToLog(
          `[L${lineNum}] Queued (${this.batchCaptions.length})`,
          'info'
        );
      }
    } else {
      try {
        const seqUsed = this.sender.getSequence();
        await this.sender.send(text, this.defaultTimestamp);
        this.config.sequence = this.sender.getSequence();
        this._recordSent(seqUsed, text);
        this.addToLog(`[L${lineNum}] Sent: ${text}`, 'success');
      } catch (err) {
        this.addToLog(`[L${lineNum}] Error: ${err.message}`, 'error');
      }
    }

    // Advance pointer after send
    if (this.currentLine < this.lines.length - 1) {
      this.currentLine++;
      this.updateTextPreview();
    }
    this.updateStatus();
  }

  /**
   * Send (or queue) a custom caption typed by the user.
   * Pointer does NOT advance — only file-line sends advance the pointer.
   */
  async sendCustomCaption(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      this.addToLog('Empty caption not sent', 'warn');
      return;
    }

    if (this.batchMode) {
      this.batchCaptions.push({ text: trimmed, timestamp: this.defaultTimestamp });
      if (this.batchCaptions.length === 1 && !this.batchTimer) {
        this.addToLog(
          `[Custom] Queued (1) — auto-send in ${this.batchTimeout}s`,
          'info'
        );
        this.batchTimer = setTimeout(() => this.sendBatch(), this.batchTimeout * 1000);
      } else {
        this.addToLog(`[Custom] Queued (${this.batchCaptions.length})`, 'info');
      }
    } else {
      try {
        const seqUsed = this.sender.getSequence();
        await this.sender.send(trimmed, this.defaultTimestamp);
        this.config.sequence = this.sender.getSequence();
        this._recordSent(seqUsed, trimmed);
        this.addToLog(`[Custom] Sent: ${trimmed}`, 'success');
      } catch (err) {
        this.addToLog(`[Custom] Error: ${err.message}`, 'error');
      }
    }

    // NOTE: pointer deliberately not advanced for custom captions
    this.updateStatus();
  }

  /**
   * Flush the batch queue to YouTube.
   */
  async sendBatch() {
    if (this.batchCaptions.length === 0) {
      this.addToLog('Batch queue is empty', 'warn');
      return;
    }

    try {
      const seqUsed = this.sender.getSequence();
      const count = this.batchCaptions.length;
      await this.sender.sendBatch(this.batchCaptions);
      this.config.sequence = this.sender.getSequence();
      // Record each caption individually in the sent panel
      this.batchCaptions.forEach((cap, i) => {
        this._recordSent(seqUsed + i, cap.text);
      });
      this.addToLog(`Batch sent: ${count} caption(s) (seq ${seqUsed})`, 'success');
    } catch (err) {
      this.addToLog(`Batch error: ${err.message}`, 'error');
    }

    this.batchCaptions = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.updateStatus();
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  /**
   * Record a caption that was actually sent to the right panel.
   */
  _recordSent(seq, text) {
    const timestamp = new Date().toLocaleTimeString();
    this.sentCaptions.push({ seq, timestamp, text });
    if (this.sentCaptions.length > this.maxSentCaptions) {
      this.sentCaptions.shift();
    }
    if (this.captionsBox) {
      this.updateCaptionsBox();
    }
  }

  /**
   * Append a message to the operational log (left lower panel).
   */
  addToLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.logMessages.push({ timestamp, message, type });
    if (this.logMessages.length > this.maxLogMessages) {
      this.logMessages.shift();
    }
    if (this.logBox) {
      this.updateLogBox();
    }
  }

  // ─── Screen initialisation ───────────────────────────────────────────────

  /**
   * Build and display the full-screen blessed layout:
   *
   *   ┌──────────────────────────────── title (1 row) ──────────────────────┐
   *   │ Text Preview (left ~60%)        │ Sent Captions (right ~40%)        │
   *   │  loaded file / URL content      │  #seq [time] text                 │
   *   │  ► pointer on current line      │                                   │
   *   ├─────────────────────────────────┤                                   │
   *   │ Log (left ~60%)                 │                                   │
   *   │  operational messages           │                                   │
   *   └─────────────────────────────────┴───────────────────────────────────┘
   *   ┌─────────── Input (full width, 3 rows) ──────────────────────────────┐
   *   └─────────── Status bar (full width, 1 row) ──────────────────────────┘
   */
  initScreen() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'LCYT — Live Captions for YouTube'
    });

    // ── Title bar ──────────────────────────────────────────────────────────
    const titleBar = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' LCYT — Live Captions for YouTube  |  h=help  q=quit',
      style: { fg: 'white', bg: 'blue', bold: true }
    });

    // ── Left upper: text preview ───────────────────────────────────────────
    this.textPreview = blessed.box({
      top: 1,
      left: 0,
      width: '60%',
      height: '55%',
      label: ' Text ',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'cyan' }
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      tags: true
    });

    // ── Left lower: operational log ────────────────────────────────────────
    this.logBox = blessed.box({
      top: '55%',
      left: 0,
      width: '60%',
      bottom: 5,
      label: ' Log ',
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' },
        label: { fg: 'yellow' }
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      tags: true
    });

    // ── Right: sent captions list ──────────────────────────────────────────
    this.captionsBox = blessed.box({
      top: 1,
      left: '60%',
      width: '40%',
      bottom: 5,
      label: ' Sent Captions ',
      border: { type: 'line' },
      style: {
        border: { fg: 'green' },
        label: { fg: 'green' }
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      tags: true
    });

    // ── Bottom: input box ──────────────────────────────────────────────────
    this.inputField = blessed.textbox({
      bottom: 1,
      left: 0,
      width: '100%',
      height: 3,
      label: ' Input — Enter: send file line | text: custom caption | /cmd: command | +N/-N: move pointer ',
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: 'red' },
        focus: { fg: 'white', border: { fg: 'red' } }
      },
      inputOnFocus: true,
      keys: true,
      mouse: true,
      vi: false
    });

    // ── Status bar ─────────────────────────────────────────────────────────
    this.statusBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' Ready',
      tags: true,
      style: { fg: 'white', bg: 'blue' }
    });

    this.screen.append(titleBar);
    this.screen.append(this.textPreview);
    this.screen.append(this.logBox);
    this.screen.append(this.captionsBox);
    this.screen.append(this.inputField);
    this.screen.append(this.statusBar);

    this.setupKeyBindings();

    // Re-render status bar on terminal resize to keep right-alignment correct
    this.screen.on('resize', () => { this.updateStatus(); });

    this.screen.render();
  }

  // ─── Widget update methods ───────────────────────────────────────────────

  updateTextPreview() {
    if (!this.textPreview) return;

    if (this.lines.length === 0) {
      this.textPreview.setLabel(' Text ');
      this.textPreview.setContent(
        '\n  No content loaded.\n  Use /load <file>  or  /fetch <url>'
      );
      this.screen.render();
      return;
    }

    const src = this.loadedFile ? basename(this.loadedFile) : 'unknown';
    this.textPreview.setLabel(
      ` Text — ${src}  L${this.currentLine + 1}/${this.lines.length} `
    );

    let content = '';
    for (const line of this.getContextLines()) {
      const pointer = line.isCurrent
        ? '{green-fg}{bold}►{/bold}{/green-fg}'
        : ' ';
      const num = String(line.lineNum).padStart(4, ' ');
      const isHeading = line.text.trim().startsWith('#');

      let pre = '';
      let post = '';
      if (line.isCurrent) {
        pre = '{black-bg}{white-fg}{bold}';
        post = '{/bold}{/white-fg}{/black-bg}';
      } else if (isHeading) {
        pre = '{blue-fg}{bold}';
        post = '{/bold}{/blue-fg}';
      }

      content += `${pointer}${pre}${num}│ ${line.text}${post}\n`;
    }

    this.textPreview.setContent(content);
    this.screen.render();
  }

  updateLogBox() {
    if (!this.logBox) return;

    let content = '';
    for (const entry of this.logMessages) {
      const { color, symbol } = _logStyle(entry.type);
      content +=
        `{${color}-fg}${symbol}{/${color}-fg} ` +
        `{gray-fg}${entry.timestamp}{/gray-fg} ` +
        `${entry.message}\n`;
    }

    this.logBox.setContent(content);
    this.logBox.scrollTo(this.logMessages.length);
    this.screen.render();
  }

  updateCaptionsBox() {
    if (!this.captionsBox) return;

    const tsLabel = this.showTimestamps ? 'ts on' : 'ts off';
    this.captionsBox.setLabel(` Sent Captions [${tsLabel}] `);

    let content = '';
    if (this.sentCaptions.length === 0) {
      content = '\n  No captions sent yet.';
    } else {
      for (const c of this.sentCaptions) {
        const seq = String(c.seq).padStart(3, ' ');
        if (this.showTimestamps) {
          content +=
            `{yellow-fg}#${seq}{/yellow-fg} ` +
            `{gray-fg}[${c.timestamp}]{/gray-fg} ` +
            `${c.text}\n`;
        } else {
          content += `{yellow-fg}#${seq}{/yellow-fg} ${c.text}\n`;
        }
      }
    }

    this.captionsBox.setContent(content);
    this.captionsBox.scrollTo(this.sentCaptions.length);
    this.screen.render();
  }

  updateStatus(message = 'Ready') {
    if (!this.statusBar) return;

    const seq = this.sender.getSequence();

    // Stream key — show first 8 chars then ellipsis for brevity/privacy
    const rawKey = this.config.streamKey || '';
    const truncKey = rawKey.length > 10
      ? rawKey.substring(0, 8) + '…'
      : (rawKey || '(no key)');

    const lineInfo =
      this.lines.length > 0
        ? `  L:${this.currentLine + 1}/${this.lines.length}`
        : '';
    const batchInfo = this.batchMode
      ? `  BATCH:${this.batchCaptions.length}/${this.batchTimeout}s`
      : '';

    const leftPart = ` ${message}  Key:${truncKey}  Seq:${seq}${lineInfo}${batchInfo}`;

    // YouTube live indicator — derived from silent heartbeat probes
    let ytTagged, ytRaw;
    if (this.youtubeStatus === 'live') {
      ytTagged = '{red-fg}●{/red-fg} Live';
      ytRaw    = '● Live';
    } else if (this.youtubeStatus === 'offline') {
      ytTagged = '○ Offline';
      ytRaw    = '○ Offline';
    } else {
      ytTagged = '{gray-fg}…{/gray-fg}';
      ytRaw    = '…';
    }
    const rightPart    = `YouTube: ${ytTagged}  `;
    const rightPartRaw = `YouTube: ${ytRaw}  `;

    const totalWidth = (this.screen && this.screen.width) ? this.screen.width : 80;
    const padLen = Math.max(0, totalWidth - leftPart.length - rightPartRaw.length);

    this.statusBar.setContent(leftPart + ' '.repeat(padLen) + rightPart);
    this.screen.render();
  }

  // ─── YouTube live status polling ─────────────────────────────────────────

  /**
   * Silently probe the caption ingestion endpoint to determine live status.
   * An empty POST (heartbeat) returns 200 when the stream is live.
   * This uses fetch directly to avoid routing through the sender's logger.
   */
  async _pollYoutubeStatus() {
    if (!this.sender.ingestionUrl) {
      this.youtubeStatus = 'offline';
      this.updateStatus();
      return;
    }

    try {
      const url = new URL(this.sender.ingestionUrl);
      url.searchParams.set('seq', String(this.sender.getSequence()));

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Content-Length': '0' },
        body: '',
        signal: AbortSignal.timeout(8000)
      });

      this.youtubeStatus = response.ok ? 'live' : 'offline';
    } catch {
      // Network error or timeout — leave status unknown
      this.youtubeStatus = null;
    }

    this.updateStatus();
  }

  /**
   * Start periodic YouTube live status polling.
   * Polls immediately (after a short settle delay), then every 30 seconds.
   */
  startYoutubeStatusPolling() {
    setTimeout(() => this._pollYoutubeStatus(), 2000);
    this.youtubePoller = setInterval(() => this._pollYoutubeStatus(), 30000);
  }

  // ─── Key bindings ────────────────────────────────────────────────────────

  setupKeyBindings() {
    // Arrow navigation — always bound to input field (always focused)
    this.inputField.key(['up'], () => { this.shiftPointer(-1); });
    this.inputField.key(['down'], () => { this.shiftPointer(1); });
    this.inputField.key(['pageup'], () => { this.shiftPointer(-10); });
    this.inputField.key(['pagedown'], () => { this.shiftPointer(10); });

    // Quick keys
    this.inputField.key(['h'], () => { this.showHelp(); });
    this.inputField.key(['q'], () => { this.cleanup(); process.exit(0); });
    this.inputField.key(['C-c'], () => { this.cleanup(); process.exit(0); });

    // Enter — the main action handler
    this.inputField.key(['enter'], async () => {
      const raw = this.inputField.getValue();
      const value = raw.trim();
      this.inputField.clearValue();

      if (!value) {
        // Empty input → send current file line + advance pointer
        await this.sendCurrentLine();
        this.inputField.focus();
        this.screen.render();
        return;
      }

      // +N / -N (with or without leading /)
      const shiftMatch = value.match(/^\/?([+-])(\d+)$/);
      if (shiftMatch) {
        const dir = shiftMatch[1] === '+' ? 1 : -1;
        const n = parseInt(shiftMatch[2], 10);
        if (!this.shiftPointer(dir * n)) {
          this.addToLog('Cannot move pointer out of bounds', 'warn');
        }
      } else if (value.startsWith('/')) {
        await this.handleCommand(value);
      } else {
        // Plain text → custom caption (pointer does NOT advance)
        await this.sendCustomCaption(value);
      }

      this.inputField.focus();
      this.screen.render();
    });
  }

  // ─── Command handler ─────────────────────────────────────────────────────

  async handleCommand(cmd) {
    const parts = cmd.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {

      // ── /load <file> [line] ──────────────────────────────────────────────
      case '/load': {
        if (args.length === 0) {
          this.addToLog('Usage: /load <filepath> [line_number]', 'warn');
          break;
        }
        const last = args[args.length - 1];
        const lineNum = parseInt(last, 10);
        const hasLine = !isNaN(lineNum) && args.length > 1;
        const filepath = hasLine ? args.slice(0, -1).join(' ') : args.join(' ');

        if (this.loadFile(filepath)) {
          if (hasLine) {
            this.gotoLine(lineNum)
              ? this.addToLog(`Jumped to line ${lineNum}`, 'info')
              : this.addToLog(`Line ${lineNum} out of range`, 'warn');
          }
          this.updateTextPreview();
        }
        break;
      }

      // ── /fetch <url> ─────────────────────────────────────────────────────
      case '/fetch': {
        if (args.length === 0) {
          this.addToLog('Usage: /fetch <url>', 'warn');
          break;
        }
        const url = args.join(' ');
        await this.fetchUrl(url);
        this.updateTextPreview();
        break;
      }

      // ── /reload ──────────────────────────────────────────────────────────
      case '/reload': {
        if (!this.loadedFile) {
          this.addToLog('No content loaded', 'warn');
          break;
        }
        const isUrl =
          this.loadedFile.startsWith('http://') ||
          this.loadedFile.startsWith('https://');
        if (isUrl) {
          await this.fetchUrl(this.loadedFile);
        } else {
          this.loadFile(this.loadedFile);
        }
        this.updateTextPreview();
        break;
      }

      // ── /goto <N> ────────────────────────────────────────────────────────
      case '/goto': {
        if (args.length === 0) {
          this.addToLog('Usage: /goto <line_number>', 'warn');
          break;
        }
        const n = parseInt(args[0], 10);
        if (isNaN(n)) {
          this.addToLog(`Not a number: ${args[0]}`, 'warn');
        } else if (!this.gotoLine(n)) {
          this.addToLog(`Line ${n} out of range (1–${this.lines.length})`, 'warn');
        } else {
          this.addToLog(`Jumped to line ${n}`, 'info');
        }
        break;
      }

      // ── /timestamps  /ts ─────────────────────────────────────────────────
      case '/timestamps':
      case '/ts': {
        this.showTimestamps = !this.showTimestamps;
        this.addToLog(
          `Timestamps ${this.showTimestamps ? 'enabled' : 'disabled'} in sent captions panel`,
          'info'
        );
        this.updateCaptionsBox();
        break;
      }

      // ── /batch [seconds] ─────────────────────────────────────────────────
      case '/batch': {
        if (args.length > 0) {
          const secs = parseInt(args[0], 10);
          if (!isNaN(secs) && secs > 0) this.batchTimeout = secs;
        }
        this.batchMode = !this.batchMode;
        if (this.batchMode) {
          this.batchCaptions = [];
          if (this.batchTimer) { clearTimeout(this.batchTimer); this.batchTimer = null; }
          this.addToLog(`Batch mode ON — auto-send after ${this.batchTimeout}s`, 'info');
        } else {
          if (this.batchCaptions.length > 0) await this.sendBatch();
          this.addToLog('Batch mode OFF', 'info');
        }
        this.updateStatus();
        break;
      }

      // ── /send ─────────────────────────────────────────────────────────────
      case '/send': {
        if (this.batchCaptions.length === 0) {
          this.addToLog('Batch queue is empty', 'warn');
        } else {
          await this.sendBatch();
        }
        break;
      }

      // ── /status ──────────────────────────────────────────────────────────
      case '/status': {
        const file = this.loadedFile || 'none';
        const line = this.lines.length > 0 ? `${this.currentLine + 1}/${this.lines.length}` : '—';
        const seq = this.sender.getSequence();
        const batch = this.batchMode
          ? `ON (${this.batchCaptions.length} queued, ${this.batchTimeout}s)`
          : 'OFF';
        this.addToLog(
          `Source: ${file}  Line: ${line}  Seq: ${seq}  Batch: ${batch}`,
          'info'
        );
        break;
      }

      // ── /heartbeat ───────────────────────────────────────────────────────
      case '/heartbeat': {
        try {
          const result = await this.sender.heartbeat();
          const ts = result.serverTimestamp ? `  Server: ${result.serverTimestamp}` : '';
          this.addToLog(`Heartbeat OK${ts}`, 'success');
        } catch (err) {
          this.addToLog(`Heartbeat failed: ${err.message}`, 'error');
        }
        break;
      }

      // ── /help  /? ────────────────────────────────────────────────────────
      case '/help':
      case '/?': {
        this.showHelp();
        break;
      }

      // ── /quit  /exit ──────────────────────────────────────────────────────
      case '/quit':
      case '/exit': {
        this.cleanup();
        process.exit(0);
        break;
      }

      default:
        this.addToLog(`Unknown command: ${cmd}`, 'warn');
    }
  }

  // ─── Help dialog ─────────────────────────────────────────────────────────

  showHelp() {
    const helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '82%',
      height: '85%',
      border: 'line',
      label: ' LCYT Help — ESC / q to close ',
      tags: true,
      keys: true,
      vi: true,
      scrollable: true,
      alwaysScroll: true,
      style: { border: { fg: 'white' } },
      content: `
{bold}LCYT Fullscreen Mode{/bold}

{cyan-fg}Screen Layout:{/cyan-fg}
  Left upper   Text preview — loaded file or URL content with pointer
  Left lower   Log — operational messages and send results
  Right        Sent Captions — history sent to YouTube (seq # on left)
  Bottom bar   Input field (always focused)
  Status bar   Current sequence, line position, batch status

{cyan-fg}Input Behaviour:{/cyan-fg}
  Enter (empty)    Send current file line → pointer advances to next line
  text + Enter     Send as custom caption  (pointer does NOT advance)
  /command         Execute a command
  +N  or  -N       Move pointer forward / backward N lines (no / needed)

{cyan-fg}Navigation Keys (active even while typing):{/cyan-fg}
  ↑ / ↓           Move pointer one line
  PageUp / Down   Move pointer 10 lines
  h               Show this help
  q  or  Ctrl+C   Quit

{cyan-fg}Commands:{/cyan-fg}
  /load <file> [N]      Load a local text file; optionally jump to line N
  /fetch <url>          Fetch plain text from a URL and load it
  /reload               Reload current file or re-fetch current URL
  /goto <N>             Jump pointer to line N (1-indexed)
  /timestamps  /ts      Toggle timestamps in the Sent Captions panel
  /batch [secs]         Toggle batch mode (auto-send after N seconds)
  /send                 Flush the batch queue immediately
  /status               Print current status to the Log panel
  /heartbeat            Send heartbeat to YouTube
  /help  /?             Show this help
  /quit  /exit          Exit

{cyan-fg}Sent Captions Panel (right):{/cyan-fg}
  Each sent caption shows:  #seq [HH:MM:SS] caption text
  Use /timestamps or /ts to toggle the [HH:MM:SS] timestamp column.
  #seq is the YouTube API sequence number used for that caption.

{cyan-fg}Examples:{/cyan-fg}
  /load script.txt        Load a file
  /load script.txt 42     Load and jump to line 42
  /fetch https://…        Fetch content from a URL
  Hello world             Send custom caption (pointer unchanged)
  +5                      Skip forward 5 lines
  -2                      Go back 2 lines
  /batch 10               Enable batch mode with 10-second auto-send
  /ts                     Toggle timestamps in the captions panel

{yellow-fg}Press ESC or q to close this help{/yellow-fg}
      `
    });

    helpBox.key(['escape', 'q'], () => {
      helpBox.destroy();
      this.inputField.focus();
      this.screen.render();
    });

    helpBox.focus();
    this.screen.render();
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async start() {
    this.initScreen();
    this.updateTextPreview();
    this.updateLogBox();
    this.updateCaptionsBox();
    this.updateStatus('Ready');
    this.inputField.focus();
    this.addToLog(
      'Ready — type text to send, /command to run a command, h for help.',
      'info'
    );
    this.startYoutubeStatusPolling();
  }

  cleanup() {
    logger.setCallback(null);

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.youtubePoller) {
      clearInterval(this.youtubePoller);
      this.youtubePoller = null;
    }

    if (this.screen) {
      this.screen.destroy();
    }

    saveConfig(this.configPath, this.config);
    this.sender.end();
  }
}

// ─── Module-level helpers ────────────────────────────────────────────────────

/**
 * Map a log entry type to a blessed colour + symbol.
 */
function _logStyle(type) {
  switch (type) {
    case 'success': return { color: 'green',  symbol: '✓' };
    case 'error':   return { color: 'red',    symbol: '✗' };
    case 'warn':    return { color: 'yellow', symbol: '!' };
    case 'info':    return { color: 'cyan',   symbol: 'ℹ' };
    default:        return { color: 'white',  symbol: '·' };
  }
}
